import { describe, expect, it } from 'vitest';
import { PAT_PREFIX, generatePersonalAccessToken, isPersonalAccessToken } from './token.js';

describe('personal access token format', () => {
	it('generates pat_ + 43 base64url chars', () => {
		const token = generatePersonalAccessToken();
		expect(token.startsWith(PAT_PREFIX)).toBe(true);
		expect(token).toHaveLength(47);
		expect(token.slice(4)).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('generates distinct tokens', () => {
		expect(generatePersonalAccessToken()).not.toBe(generatePersonalAccessToken());
	});

	it('recognizes its own format and nothing else', () => {
		expect(isPersonalAccessToken(generatePersonalAccessToken())).toBe(true);
		expect(isPersonalAccessToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe(false);
		expect(isPersonalAccessToken('pat_short')).toBe(false);
		expect(isPersonalAccessToken('')).toBe(false);
	});
});
