const plainTextRules: [RegExp, string][] = [
	[/<<([^>]*?)>>/g, '$1'],
	[/\[q]/g, '«'],
	[/\[\/q]/g, '»'],
	[/\[img[^\]]*].*?\[\/img]?/igs, ''],
	[/\[[^[]*]/g, ''],
	[/\[\/[^[]*]/g, ''],
];

export const stripBBCode = (text: string): string =>
	plainTextRules.reduce(
		(result, [pattern, replacement]) => result.replace(pattern, replacement),
		text,
	);

export const stripNoteMarkers = (text: string): string =>
	text.replace(/\{!?.*?}/g, '').replace(/ {2,}/g, ' ');

export const extractInlineNotes = (text: string): string[] => {
	const notes: string[] = [];
	text.replace(/\{!?(.*?)}/g, (_, content: string) => {
		if (content) notes.push(content);
		return '';
	});
	return notes;
};

export const prepareText = (text: string): string =>
	stripBBCode(stripNoteMarkers(text));

export const prepareNotes = (notes: { text: string }[]): string =>
	notes.map((n) => stripBBCode(n.text)).join('\n');

export const extractAudioTitles = (infoJson: string | null): string[] => {
	if (!infoJson) return [];

	try {
		const info = JSON.parse(infoJson) as { attachments?: { audio?: { title?: string }[] } };
		return (info.attachments?.audio ?? [])
			.map((a) => a.title)
			.filter((t): t is string => t != null);
	} catch {
		return [];
	}
};
