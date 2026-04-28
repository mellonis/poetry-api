// Canonical text-normalization rules for legacy thing/news content.
//
// Applied once in the DB migration that bakes these substitutions into stored text,
// and again on the api save-side so non-CMS writers stay canonical. Renderers no
// longer apply these — stored text is already canonical.
//
// The 4 dash-context rules MUST run before the bare `--` rule, otherwise `---`
// gets eaten as `–-`.
const rules: [RegExp, string][] = [
	[/^---\s/mg, '—\u00A0'],
	[/]---\s/g, ']—\u00A0'],
	[/([(:])(\s)?\s*---\s/g, '$1$2—\u00A0'],
	[/\s---/g, '\u00A0—'],
	[/--/g, '–'],
	[/`/g, '\u0301'],
	[/\[nbsp]/g, '\u00A0'],
];

export const normalizeLegacyText = (text: string): string =>
	rules
		.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
		.normalize('NFC');

// Apply normalizeLegacyText only where it's safe inside thing_info.text JSON:
// to audio[].title strings. URLs (sources[].src) and structural keys are left
// untouched. Invalid JSON falls through unchanged.
export const normalizeLegacyInfoJson = (json: string): string => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return json;
	}

	const audio = (parsed as { attachments?: { audio?: unknown } } | null)?.attachments?.audio;
	if (Array.isArray(audio)) {
		for (const item of audio) {
			if (item && typeof item === 'object' && 'title' in item) {
				const t = (item as { title?: unknown }).title;
				if (typeof t === 'string') {
					(item as { title: string }).title = normalizeLegacyText(t);
				}
			}
		}
	}

	return JSON.stringify(parsed, null, 2);
};
