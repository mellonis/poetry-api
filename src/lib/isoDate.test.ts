import { describe, expect, it } from 'vitest';
import { dbDateToIso, isoDateToDb, isValidIsoDate } from './isoDate.js';

describe('dbDateToIso', () => {
	it('passes full dates through', () => {
		expect(dbDateToIso('1990-05-12')).toBe('1990-05-12');
	});

	it('trims day-only-unknown to YYYY-MM', () => {
		expect(dbDateToIso('1990-05-00')).toBe('1990-05');
	});

	it('trims month-and-day-unknown to YYYY', () => {
		expect(dbDateToIso('1990-00-00')).toBe('1990');
	});

	it('trims undated 0000-00-00 to 0000', () => {
		expect(dbDateToIso('0000-00-00')).toBe('0000');
	});

	it('passes non-DB-shaped strings through unchanged', () => {
		expect(dbDateToIso('1990')).toBe('1990');
		expect(dbDateToIso('not a date')).toBe('not a date');
	});
});

describe('isoDateToDb', () => {
	it('passes full ISO dates through', () => {
		expect(isoDateToDb('1990-05-12')).toBe('1990-05-12');
	});

	it('pads year-month with -00', () => {
		expect(isoDateToDb('1990-05')).toBe('1990-05-00');
	});

	it('pads year-only with -00-00', () => {
		expect(isoDateToDb('1990')).toBe('1990-00-00');
	});

	it('throws on invalid ISO shape', () => {
		expect(() => isoDateToDb('1990-5')).toThrow();
		expect(() => isoDateToDb('90-05-12')).toThrow();
		expect(() => isoDateToDb('1990-05-12-extra')).toThrow();
	});
});

describe('isValidIsoDate', () => {
	it('accepts year-only', () => {
		expect(isValidIsoDate('1990')).toBe(true);
		expect(isValidIsoDate('0001')).toBe(true);
	});

	it('accepts year-month', () => {
		expect(isValidIsoDate('1990-01')).toBe(true);
		expect(isValidIsoDate('1990-12')).toBe(true);
	});

	it('accepts full date', () => {
		expect(isValidIsoDate('1990-05-12')).toBe(true);
		expect(isValidIsoDate('2020-02-29')).toBe(true); // leap year
	});

	it('rejects malformed shapes', () => {
		expect(isValidIsoDate('90')).toBe(false);
		expect(isValidIsoDate('1990-5')).toBe(false);
		expect(isValidIsoDate('1990-05-1')).toBe(false);
		expect(isValidIsoDate('1990-05-12-extra')).toBe(false);
		expect(isValidIsoDate('')).toBe(false);
	});

	it('rejects out-of-range months', () => {
		expect(isValidIsoDate('1990-00')).toBe(false);
		expect(isValidIsoDate('1990-13')).toBe(false);
	});

	it('rejects out-of-range days', () => {
		expect(isValidIsoDate('1990-05-00')).toBe(false);
		expect(isValidIsoDate('1990-05-32')).toBe(false);
	});

	it('rejects day-in-month mismatch', () => {
		expect(isValidIsoDate('1990-02-31')).toBe(false);
		expect(isValidIsoDate('2021-02-29')).toBe(false); // not a leap year
		expect(isValidIsoDate('1990-04-31')).toBe(false);
	});
});
