import { describe, it, expect } from 'vitest';
import { normalizeDisplayName, reservedCheckKey, validateDisplayName } from '../displayName.js';

describe('normalizeDisplayName', () => {
  it('trims whitespace', () => {
    expect(normalizeDisplayName('  hello  ')).toBe('hello');
  });
  it('collapses consecutive spaces', () => {
    expect(normalizeDisplayName('a  b')).toBe('a b');
  });
  it('NFC-normalizes', () => {
    // café decomposed (e + combining acute) → café composed
    const decomposed = 'café';
    expect(normalizeDisplayName(decomposed)).toBe('café');
  });
});

describe('reservedCheckKey', () => {
  it('lowercases', () => {
    expect(reservedCheckKey('Admin')).toBe('admin');
  });
  it('folds Cyrillic homoglyphs to Latin', () => {
    // Cyrillic а (U+0430) → Latin a, so 'аdmin' (Cyrillic а + Latin dmin) → 'admin'
    expect(reservedCheckKey('аdmin')).toBe('admin');
  });
  it('is idempotent on Latin-only input', () => {
    expect(reservedCheckKey('mellonis')).toBe('mellonis');
  });
});

describe('validateDisplayName', () => {
  it('accepts valid Cyrillic+Latin+digit+space', () => {
    expect(validateDisplayName('Иван Petrov 42')).toEqual({ ok: true, value: 'Иван Petrov 42' });
  });
  it('accepts max-length 64 chars', () => {
    expect(validateDisplayName('a'.repeat(64))).toEqual({ ok: true, value: 'a'.repeat(64) });
  });
  it('rejects empty string', () => {
    expect(validateDisplayName('')).toMatchObject({ ok: false });
  });
  it('rejects string longer than 64 chars', () => {
    expect(validateDisplayName('a'.repeat(65))).toMatchObject({ ok: false });
  });
  it('rejects special characters', () => {
    expect(validateDisplayName('user@example')).toMatchObject({ ok: false });
  });
  it('rejects consecutive spaces after normalize', () => {
    expect(validateDisplayName('a  b')).toMatchObject({ ok: false });
  });
  it('trims before validating', () => {
    expect(validateDisplayName('  hello  ')).toEqual({ ok: true, value: 'hello' });
  });
  it('rejects blank-after-trim', () => {
    expect(validateDisplayName('   ')).toMatchObject({ ok: false });
  });
});
