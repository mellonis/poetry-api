export const COMMENT_MIN_LENGTH = 2;
export const COMMENT_MAX_LENGTH = 4000;

export type SanitizeResult =
	| { ok: true; text: string }
	| { ok: false; error: 'TEXT_INVALID' | 'TEXT_EMPTY' | 'TEXT_TOO_SHORT' | 'TEXT_TOO_LONG' | 'TEXT_FLOOD' };

export const sanitizeCommentText = (input: unknown): SanitizeResult => {
	if (typeof input !== 'string') return { ok: false, error: 'TEXT_INVALID' };

	let t = input.normalize('NFC');
	t = t.replace(/\r\n?/g, '\n');
	t = t.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
	t = t.replace(/\n{3,}/g, '\n\n');
	t = t.replace(/[ \t]+\n/g, '\n').replace(/[ \t]+$/g, '');
	t = t.trim();

	if (t.length === 0) return { ok: false, error: 'TEXT_EMPTY' };
	if (t.length < COMMENT_MIN_LENGTH) return { ok: false, error: 'TEXT_TOO_SHORT' };
	if (t.length > COMMENT_MAX_LENGTH) return { ok: false, error: 'TEXT_TOO_LONG' };

	if (/(.)\1{49,}/u.test(t)) return { ok: false, error: 'TEXT_FLOOD' };

	return { ok: true, text: t };
};
