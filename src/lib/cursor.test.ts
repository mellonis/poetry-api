import { describe, expect, it } from 'vitest';
import { encodeCursor, decodeCursor } from './cursor.js';

describe('cursor codec', () => {
	it('round-trips a (Date, id) pair', () => {
		const d = new Date('2026-05-18T12:34:56.789Z');
		const encoded = encodeCursor(d, 42);
		const decoded = decodeCursor(encoded);
		expect(decoded).toEqual({ updatedAtMs: d.getTime(), id: 42 });
	});

	it('produces a base64url-safe string (no +/= chars)', () => {
		const encoded = encodeCursor(new Date(), 1);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('returns null on a malformed input', () => {
		expect(decodeCursor('not-a-valid-cursor!')).toBeNull();
	});

	it('returns null when the decoded payload is missing parts', () => {
		// "abc" without the underscore separator
		const broken = Buffer.from('abc', 'utf8').toString('base64url');
		expect(decodeCursor(broken)).toBeNull();
	});

	it('returns null when the id portion is not a positive integer', () => {
		const payload = '1234567890_abc';
		const broken = Buffer.from(payload, 'utf8').toString('base64url');
		expect(decodeCursor(broken)).toBeNull();
	});

	it('rejects negative timestamps', () => {
		const payload = '-1_5';
		const broken = Buffer.from(payload, 'utf8').toString('base64url');
		expect(decodeCursor(broken)).toBeNull();
	});
});
