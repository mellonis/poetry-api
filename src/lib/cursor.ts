// Keyset-pagination cursor for the notifications list endpoint.
// Encodes (updatedAtMs, id) as "<ms>_<id>" then base64url. Opaque to
// clients — the server decodes and applies (updated_at, id) < cursor.

export const encodeCursor = (updatedAt: Date, id: number): string => {
	const payload = `${updatedAt.getTime()}_${id}`;
	return Buffer.from(payload, 'utf8').toString('base64url');
};

export const decodeCursor = (cursor: string): { updatedAtMs: number; id: number } | null => {
	let decoded: string;
	try {
		decoded = Buffer.from(cursor, 'base64url').toString('utf8');
	} catch {
		return null;
	}

	const parts = decoded.split('_');
	if (parts.length !== 2) return null;

	const updatedAtMs = Number(parts[0]);
	const id = Number(parts[1]);

	if (!Number.isInteger(updatedAtMs) || updatedAtMs < 0) return null;
	if (!Number.isInteger(id) || id <= 0) return null;

	return { updatedAtMs, id };
};
