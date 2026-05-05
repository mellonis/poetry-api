import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// Forbidden patterns: a log call whose first argument object contains
// `userId`, `user_id`, or `login` as a property name (shorthand or explicit
// key). Uses `[{,]` followed by optional whitespace so it catches both
// `{ userId }` (shorthand) and `{ login: user.login, userId }` (explicit
// key after comma). Does NOT catch `actorFingerprint(userId)` because
// `userId` there follows `(`, not `{` or `,`.
//
// Covers three logger styles:
//   - `request.log.*`  — route handlers
//   - `fastify.log.*`  — plugin-level code
//   - `*.logger.*`     — class-level loggers (e.g. `this.logger.*` in
//                        EmailAuthNotifier / ConsoleAuthNotifier)
//
// Limitation: multi-line log calls are not checked. This is intentional —
// keeping calls on one line is itself a style constraint the migration enforced.
const FORBIDDEN_REGEX =
	String.raw`((request|fastify)\.log|\.logger)\.(info|warn|error|debug)\([^)]*[{,][[:space:]]*\b(userId|user_id|login)\b`;

const SRC_ROOT = resolve(__dirname, '../../..');

const ALLOWED_FILES = [
	'src/lib/__tests__/__fixtures__/allowed-log.ts',
];

const FORBIDDEN_FIXTURE = 'src/lib/__tests__/__fixtures__/forbidden-log.ts';

function grep(pattern: string): string[] {
	try {
		const output = execSync(
			`grep -rEn '${pattern}' src/ --include='*.ts'`,
			{ encoding: 'utf8', cwd: SRC_ROOT },
		);
		return output.split('\n').filter(Boolean);
	} catch (e) {
		// grep exits 1 when there are no matches; that's expected for the
		// "no production violations" assertion.
		const err = e as { status?: number };
		if (err.status === 1) return [];
		throw e;
	}
}

describe('no raw user identifiers in production log call sites', () => {
	it('flags the forbidden fixture (proves the regex works)', () => {
		const matches = grep(FORBIDDEN_REGEX);
		const flaggedFixture = matches.some((m) => m.startsWith(`${FORBIDDEN_FIXTURE}:`));
		expect(flaggedFixture).toBe(true);
	});

	it('does NOT flag the allowed fixture', () => {
		const matches = grep(FORBIDDEN_REGEX);
		const flagged = matches.filter((m) => ALLOWED_FILES.some((f) => m.startsWith(`${f}:`)));
		expect(flagged).toEqual([]);
	});

	it('does not flag any production source outside of the forbidden fixture', () => {
		const matches = grep(FORBIDDEN_REGEX);
		const productionMatches = matches.filter((m) => !m.startsWith(`${FORBIDDEN_FIXTURE}:`));
		expect(productionMatches).toEqual([]);
	});
});
