import { describe, expect, it } from 'vitest';
import { normalizeLegacyInfoJson, normalizeLegacyText } from './normalizeLegacyText.js';

describe('normalizeLegacyText', () => {
	it('replaces start-of-line --- with em dash + NBSP', () => {
		expect(normalizeLegacyText('--- начало')).toBe('—\u00A0начало');
	});

	it('replaces ]--- with ]— + NBSP', () => {
		expect(normalizeLegacyText('[/q]--- сказал')).toBe('[/q]—\u00A0сказал');
	});

	it('preserves capture groups after ( or :', () => {
		expect(normalizeLegacyText('(--- пример')).toBe('(—\u00A0пример');
		expect(normalizeLegacyText(': --- цитата')).toBe(': —\u00A0цитата');
	});

	it('replaces space + --- with NBSP + em dash mid-text', () => {
		expect(normalizeLegacyText('слово --- слово')).toBe('слово\u00A0— слово');
	});

	it('replaces -- with en dash', () => {
		expect(normalizeLegacyText('A -- B')).toBe('A – B');
	});

	it('replaces backtick with combining acute (NFC composes with Latin vowel)', () => {
		expect(normalizeLegacyText('e`')).toBe('é');
	});

	it('replaces backtick with combining acute (no composition for Cyrillic)', () => {
		expect(normalizeLegacyText('о`')).toBe('о\u0301');
	});

	it('replaces [nbsp] with U+00A0', () => {
		expect(normalizeLegacyText('a[nbsp]b')).toBe('a\u00A0b');
	});

	it('handles all rules combined', () => {
		const input = '--- первый\n[/q]--- второй\n(--- третий\nслово --- слово\nA -- B\nо`\na[nbsp]b';
		const expected = [
			'—\u00A0первый',
			'[/q]—\u00A0второй',
			'(—\u00A0третий',
			'слово\u00A0— слово',
			'A – B',
			'о\u0301',
			'a\u00A0b',
		].join('\n');
		expect(normalizeLegacyText(input)).toBe(expected);
	});

	it('is idempotent — second pass is a no-op', () => {
		const samples = [
			'--- первый',
			'[/q]--- второй',
			'(--- третий',
			'слово --- слово',
			'A -- B',
			'о`',
			'a[nbsp]b',
			'комбинация: --- слово -- A `e`',
			'',
			'no patterns here',
		];
		for (const s of samples) {
			const once = normalizeLegacyText(s);
			expect(normalizeLegacyText(once)).toBe(once);
		}
	});

	it('does not match --- without surrounding whitespace context (would fall through to en dash)', () => {
		// This documents the fall-through: bare `---abc` becomes `–-abc`. Pre-flight
		// scan confirmed zero such cases in current data; this test pins the behavior.
		expect(normalizeLegacyText('---abc')).toBe('–-abc');
	});

	it('passes empty string through', () => {
		expect(normalizeLegacyText('')).toBe('');
	});

	it('leaves already-normalized Cyrillic vowels with combining acute unchanged', () => {
		// Cyrillic vowels have no precomposed forms in Unicode; NFC keeps them
		// as base letter + U+0301. Many rows already have these from manual editing.
		const samples = [
			'А\u0301', 'Е\u0301', 'И\u0301', 'О\u0301', 'У\u0301',
			'Ы\u0301', 'Э\u0301', 'Ю\u0301', 'Я\u0301',
			'а\u0301', 'е\u0301', 'и\u0301', 'о\u0301', 'у\u0301',
			'ы\u0301', 'э\u0301', 'ю\u0301', 'я\u0301',
			'снега\u0301', 'любо\u0301ви',
		];
		for (const s of samples) {
			expect(normalizeLegacyText(s)).toBe(s);
		}
	});
});

describe('normalizeLegacyInfoJson', () => {
	it('normalizes audio[].title without touching URLs', () => {
		const input = JSON.stringify({
			attachments: {
				audio: [
					{
						preload: 'none',
						title: 'A -- B `тест',
						sources: [{ src: 'https://example.com/path--with-dashes.mp3', type: 'audio/mpeg' }],
					},
				],
			},
		});
		const output = normalizeLegacyInfoJson(input);
		const parsed = JSON.parse(output);
		expect(parsed.attachments.audio[0].title).toBe('A – B \u0301тест');
		expect(parsed.attachments.audio[0].sources[0].src).toBe('https://example.com/path--with-dashes.mp3');
	});

	it('returns input unchanged on invalid JSON', () => {
		expect(normalizeLegacyInfoJson('{not valid')).toBe('{not valid');
	});

	it('handles missing attachments structure', () => {
		const input = '{"foo":"bar"}';
		expect(JSON.parse(normalizeLegacyInfoJson(input))).toEqual({ foo: 'bar' });
	});

	it('is idempotent', () => {
		const input = JSON.stringify({
			attachments: { audio: [{ title: 'A -- B', sources: [{ src: 'x', type: 'audio/mpeg' }] }] },
		});
		const once = normalizeLegacyInfoJson(input);
		expect(normalizeLegacyInfoJson(once)).toBe(once);
	});
});
