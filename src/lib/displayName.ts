const CYRILLIC_TO_LATIN: Record<string, string> = {
	'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
	'в': 'b', 'н': 'h', 'к': 'k', 'м': 'm', 'т': 't',
	'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Х': 'X', 'У': 'Y',
	'В': 'B', 'Н': 'H', 'К': 'K', 'М': 'M', 'Т': 'T',
};

export function normalizeDisplayName(raw: string): string {
	return raw.trim().normalize('NFC').replace(/  +/g, ' ');
}

export function reservedCheckKey(raw: string): string {
	return normalizeDisplayName(raw)
		.split('')
		.map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
		.join('')
		.toLowerCase();
}

const ALLOWED_RE = /^[a-zA-ZÀ-ӿ0-9 ]+$/;

export type DisplayNameResult =
	| { ok: true; value: string }
	| { ok: false; error: string };

export function validateDisplayName(raw: string): DisplayNameResult {
	const trimmed = raw.trim().normalize('NFC');
	if (trimmed.length === 0) return { ok: false, error: 'display_name_empty' };
	if (trimmed.length > 64) return { ok: false, error: 'display_name_too_long' };
	if (!ALLOWED_RE.test(trimmed)) return { ok: false, error: 'display_name_invalid_chars' };
	if (/  /.test(trimmed)) return { ok: false, error: 'display_name_consecutive_spaces' };
	return { ok: true, value: trimmed };
}
