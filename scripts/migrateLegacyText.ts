// One-shot migration: bake canonical 7-rule + NFC transform into stored text.
//
// Strategy: per-row PUT /cms/things/:id via the api. The api applies defensive
// normalization through Zod transforms (added in schemas.ts), so this script
// just round-trips affected rows. The api handles last_modified, Meilisearch
// sync, and (when wired) cache invalidation.
//
// Scope:
//   - thing.text, thing.title, thing.first_lines, thing_info.text, thing_note.text
//     → PUT /cms/things/:id
//   - news.id=1 (about page) → no patterns to bake (verified in pre-flight)
//   - news.id=5 → 1 row with `--`, no api endpoint, applied via direct DB UPDATE
//   - sections, other news rows → 0 affected (verified in pre-flight)
//
// Idempotent — already-canonical rows are skipped (no PUT, no DB write).
//
// Required env: API_BASE_URL, ADMIN_LOGIN, ADMIN_PASSWORD, CONNECTION_STRING
// Usage:
//   tsx scripts/migrateLegacyText.ts            # dry-run (default)
//   tsx scripts/migrateLegacyText.ts --apply    # PUT changes via api + UPDATE news.id=5

import mysql from 'mysql2/promise';
import { normalizeLegacyInfoJson, normalizeLegacyText } from '../src/lib/normalizeLegacyText.js';

interface CmsThing {
	id: number;
	title: string | null;
	text: string;
	categoryId: number;
	statusId: number;
	startDate: string | null;
	finishDate: string;
	firstLines: string | null;
	firstLinesAutoGenerating: boolean;
	excludeFromDaily: boolean;
	notes: { id: number; text: string }[];
	seoDescription: string | null;
	seoKeywords: string | null;
	info: string | null;
}

const env = (key: string): string => {
	const v = process.env[key];
	if (!v) {
		console.error(`${key} env var is required`);
		process.exit(2);
	}
	return v;
};

const login = async (apiBase: string, loginName: string, password: string): Promise<string> => {
	const res = await fetch(`${apiBase}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ login: loginName, password }),
	});
	if (!res.ok) {
		throw new Error(`Login failed: ${res.status} ${await res.text()}`);
	}
	const body = await res.json() as { accessToken: string };
	return body.accessToken;
};

const getThing = async (apiBase: string, token: string, id: number): Promise<CmsThing> => {
	const res = await fetch(`${apiBase}/cms/things/${id}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		throw new Error(`GET /cms/things/${id} failed: ${res.status}`);
	}
	return res.json() as Promise<CmsThing>;
};

const putThing = async (apiBase: string, token: string, id: number, body: Record<string, unknown>): Promise<void> => {
	const res = await fetch(`${apiBase}/cms/things/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`PUT /cms/things/${id} failed: ${res.status} ${await res.text()}`);
	}
};

interface ChangeSet {
	changed: boolean;
	payload: Record<string, unknown>;
	fields: string[];
}

const computeChanges = (t: CmsThing): ChangeSet => {
	const payload: Record<string, unknown> = {};
	const fields: string[] = [];

	const checkText = (key: 'text' | 'title' | 'firstLines', value: string | null) => {
		if (value === null) return;
		if (normalizeLegacyText(value) !== value) {
			payload[key] = value;
			fields.push(key);
		}
	};

	checkText('text', t.text);
	checkText('title', t.title);
	checkText('firstLines', t.firstLines);

	if (t.info !== null && normalizeLegacyInfoJson(t.info) !== t.info) {
		payload.info = t.info;
		fields.push('info');
	}

	const notesNeedUpdate = t.notes.some((n) => normalizeLegacyText(n.text) !== n.text);
	if (notesNeedUpdate) {
		payload.notes = t.notes.map((n) => ({ id: n.id, text: n.text }));
		fields.push('notes');
	}

	return { changed: fields.length > 0, payload, fields };
};

async function migrateThings(apply: boolean): Promise<{ changed: number; unchanged: number }> {
	const apiBase = env('API_BASE_URL');
	const token = await login(apiBase, env('ADMIN_LOGIN'), env('ADMIN_PASSWORD'));

	const conn = await mysql.createConnection({ uri: env('CONNECTION_STRING'), charset: 'utf8mb4' });
	const [rows] = await conn.query<(mysql.RowDataPacket & { id: number })[]>('SELECT id FROM thing ORDER BY id');
	await conn.end();

	let changed = 0;
	let unchanged = 0;

	for (const { id } of rows) {
		const thing = await getThing(apiBase, token, id);
		const cs = computeChanges(thing);

		if (!cs.changed) {
			unchanged++;
			continue;
		}

		changed++;
		const tag = apply ? '✓' : '·';
		console.log(`${tag} thing ${id}: ${cs.fields.join(', ')}`);

		if (apply) {
			await putThing(apiBase, token, id, cs.payload);
		}
	}

	return { changed, unchanged };
}

async function migrateNewsId5(apply: boolean): Promise<boolean> {
	const conn = await mysql.createConnection({ uri: env('CONNECTION_STRING'), charset: 'utf8mb4' });
	try {
		const [rows] = await conn.query<(mysql.RowDataPacket & { id: number; text: string })[]>(
			'SELECT id, text FROM news WHERE id = 5',
		);
		if (rows.length === 0) return false;

		const before = rows[0].text;
		const after = normalizeLegacyText(before);
		if (before === after) return false;

		const tag = apply ? '✓' : '·';
		console.log(`${tag} news 5: text (direct DB UPDATE)`);

		if (apply) {
			await conn.execute('UPDATE news SET text = ? WHERE id = 5', [after]);
		}
		return true;
	} finally {
		await conn.end();
	}
}

async function main(): Promise<void> {
	const apply = process.argv.includes('--apply');
	console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

	const things = await migrateThings(apply);
	const newsChanged = await migrateNewsId5(apply);

	const totalChanged = things.changed + (newsChanged ? 1 : 0);
	console.log(`\n${apply ? 'APPLIED' : 'DRY-RUN'}: ${totalChanged} rows ${apply ? 'updated' : 'would update'} ` +
		`(${things.changed} things via api + ${newsChanged ? 1 : 0} news via direct DB; ${things.unchanged} things unchanged)`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
