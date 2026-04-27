import { describe, expect, it } from 'vitest';
import {
	sanitizeCommentText,
	COMMENT_MAX_LENGTH,
} from './sanitizeCommentText.js';

describe('sanitizeCommentText', () => {
	it('rejects non-string input', () => {
		expect(sanitizeCommentText(undefined)).toEqual({ ok: false, error: 'TEXT_INVALID' });
		expect(sanitizeCommentText(null)).toEqual({ ok: false, error: 'TEXT_INVALID' });
		expect(sanitizeCommentText(42)).toEqual({ ok: false, error: 'TEXT_INVALID' });
	});

	it('rejects empty / whitespace-only', () => {
		expect(sanitizeCommentText('').error).toBe('TEXT_EMPTY');
		expect(sanitizeCommentText('   \n\n\t').error).toBe('TEXT_EMPTY');
	});

	it('rejects too short after trim', () => {
		expect(sanitizeCommentText('a').error).toBe('TEXT_TOO_SHORT');
	});

	it('rejects too long', () => {
		const long = 'a'.repeat(COMMENT_MAX_LENGTH + 1);
		expect(sanitizeCommentText(long).error).toBe('TEXT_TOO_LONG');
	});

	it('accepts valid text and trims whitespace', () => {
		const result = sanitizeCommentText('  hello world  ');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toBe('hello world');
	});

	it('strips control characters but keeps tab and newline', () => {
		const result = sanitizeCommentText('hi\u0000there\u0008\nnext\tline');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toBe('hithere\nnext\tline');
	});

	it('normalizes CRLF to LF', () => {
		const result = sanitizeCommentText('a\r\nb\rc');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toBe('a\nb\nc');
	});

	it('collapses runs of 3+ blank lines to a double break', () => {
		const result = sanitizeCommentText('a\n\n\n\n\nb');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toBe('a\n\nb');
	});

	it('strips trailing whitespace per line', () => {
		const result = sanitizeCommentText('alpha   \nbeta\t\ngamma');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toBe('alpha\nbeta\ngamma');
	});

	it('NFC-normalizes Unicode (composed forms compare equal)', () => {
		const decomposed = 'cafe\u0301';
		const composed = 'caf\u00e9';
		const a = sanitizeCommentText(decomposed);
		const b = sanitizeCommentText(composed);
		expect(a.ok && b.ok).toBe(true);
		if (a.ok && b.ok) expect(a.text).toBe(b.text);
	});

	it('rejects flooding (single char repeated 50+ times)', () => {
		const flood = 'spam' + 'a'.repeat(50);
		expect(sanitizeCommentText(flood).error).toBe('TEXT_FLOOD');
	});

	it('preserves Cyrillic and emoji', () => {
		const result = sanitizeCommentText('Это тест 🎭');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toBe('Это тест 🎭');
	});
});
