import { describe, expect, it } from 'vitest';
import {
	createSectionRequest,
	createThingRequest,
	updateAuthorRequest,
	updateSectionRequest,
	updateThingRequest,
} from './schemas.js';

// Defensive normalization: Zod transforms on text fields that get rendered via
// the BBCode-like legacy renderer. SEO fields, identifier, dates, IDs, and
// settings are intentionally NOT normalized.

describe('createThingRequest normalization', () => {
	it('normalizes text, title, firstLines, and notes[].text', () => {
		const parsed = createThingRequest.parse({
			title: 'Бодрая весна --- Банзай',
			text: 'Слово --- слово',
			categoryId: 1,
			finishDate: '2024-01-15',
			firstLines: 'Хочешь послушать го`лоса',
			notes: [{ text: '[b]Пролог[/b] --- Ощущения' }],
		});
		expect(parsed.title).toBe('Бодрая весна\u00A0— Банзай');
		expect(parsed.text).toBe('Слово\u00A0— слово');
		expect(parsed.firstLines).toBe('Хочешь послушать го\u0301лоса');
		expect(parsed.notes[0].text).toBe('[b]Пролог[/b]\u00A0— Ощущения');
	});

	it('does not normalize seoDescription, seoKeywords', () => {
		const parsed = createThingRequest.parse({
			text: 'x',
			categoryId: 1,
			finishDate: '2024-01-15',
			seoDescription: 'A -- B',
			seoKeywords: '`test',
		});
		expect(parsed.seoDescription).toBe('A -- B');
		expect(parsed.seoKeywords).toBe('`test');
	});

	it('normalizes audio[].title in info JSON without touching URLs', () => {
		const info = JSON.stringify({
			attachments: {
				audio: [
					{ title: 'A -- B', sources: [{ src: 'https://x/a--b.mp3', type: 'audio/mpeg' }] },
				],
			},
		});
		const parsed = createThingRequest.parse({
			text: 'x',
			categoryId: 1,
			finishDate: '2024-01-15',
			info,
		});
		const out = JSON.parse(parsed.info!);
		expect(out.attachments.audio[0].title).toBe('A – B');
		expect(out.attachments.audio[0].sources[0].src).toBe('https://x/a--b.mp3');
	});
});

describe('updateThingRequest normalization', () => {
	it('normalizes optional text fields when present', () => {
		const parsed = updateThingRequest.parse({ text: 'A -- B' });
		expect(parsed.text).toBe('A – B');
	});

	it('leaves fields undefined when absent', () => {
		const parsed = updateThingRequest.parse({});
		expect(parsed.text).toBeUndefined();
		expect(parsed.title).toBeUndefined();
	});
});

describe('updateAuthorRequest normalization', () => {
	it('normalizes text', () => {
		const parsed = updateAuthorRequest.parse({
			text: '--- начало',
			date: '2024-01-15',
		});
		expect(parsed.text).toBe('—\u00A0начало');
	});

	it('does not normalize seoDescription, seoKeywords, date', () => {
		const parsed = updateAuthorRequest.parse({
			text: 'x',
			date: '2024-01-15',
			seoDescription: 'A -- B',
			seoKeywords: '`kw',
		});
		expect(parsed.seoDescription).toBe('A -- B');
		expect(parsed.seoKeywords).toBe('`kw');
		expect(parsed.date).toBe('2024-01-15');
	});
});

describe('createSectionRequest / updateSectionRequest normalization', () => {
	it('normalizes title, description, annotationText, annotationAuthor', () => {
		const parsed = createSectionRequest.parse({
			identifier: 'sec1',
			title: 'A -- B',
			description: '--- desc',
			annotationText: 'note `a`',
			annotationAuthor: 'X -- Y',
			typeId: 1,
		});
		expect(parsed.title).toBe('A – B');
		expect(parsed.description).toBe('—\u00A0desc');
		// Latin `a` + U+0301 NFC-composes to `á` (U+00E1); leading stranded acute
		// stays as combining char on the preceding space.
		expect(parsed.annotationText).toBe('note \u0301\u00E1');
		expect(parsed.annotationAuthor).toBe('X – Y');
	});

	it('does not normalize identifier', () => {
		const parsed = createSectionRequest.parse({
			identifier: 'foo123',
			title: 't',
			typeId: 1,
		});
		expect(parsed.identifier).toBe('foo123');
	});

	it('updateSectionRequest normalizes optional fields', () => {
		const parsed = updateSectionRequest.parse({ title: 'A -- B' });
		expect(parsed.title).toBe('A – B');
	});
});
