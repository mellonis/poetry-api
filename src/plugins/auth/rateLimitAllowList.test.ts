import { describe, expect, it, beforeAll } from 'vitest';
import { signAccessToken, type AccessTokenPayload } from './jwt.js';
import { isRateLimitExempt } from './rateLimitAllowList.js';

const secret = new TextEncoder().encode('test-secret-at-least-32-characters-long!');
const wrongSecret = new TextEncoder().encode('a-different-secret-also-32-chars-long!!!');

const payload = (over: Partial<AccessTokenPayload> = {}): AccessTokenPayload => ({
	sub: 1,
	login: 'someone',
	isAdmin: false,
	isEditor: false,
	tokenVersion: 0,
	rights: { canVote: true, canComment: true, canEditContent: false, canEditUsers: false },
	...over,
});

const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} });

beforeAll(() => {
	process.env.JWT_ACCESS_TOKEN_TTL = '900';
});

describe('isRateLimitExempt', () => {
	it('is false with no Authorization header', async () => {
		expect(await isRateLimitExempt(req(), secret)).toBe(false);
	});

	it('is false for a non-Bearer scheme', async () => {
		expect(await isRateLimitExempt(req('Basic abc'), secret)).toBe(false);
	});

	it('exempts a validly-signed editor token', async () => {
		const token = await signAccessToken(payload({ isEditor: true }), secret);
		expect(await isRateLimitExempt(req(`Bearer ${token}`), secret)).toBe(true);
	});

	it('exempts a validly-signed admin token', async () => {
		const token = await signAccessToken(payload({ isAdmin: true }), secret);
		expect(await isRateLimitExempt(req(`Bearer ${token}`), secret)).toBe(true);
	});

	it('does not exempt a validly-signed non-staff token', async () => {
		const token = await signAccessToken(payload(), secret);
		expect(await isRateLimitExempt(req(`Bearer ${token}`), secret)).toBe(false);
	});

	it('does not exempt a forged admin token signed with the wrong secret', async () => {
		// The bypass this guards against: a payload claiming isAdmin whose
		// signature the server cannot validate. Verifying (not decoding) rejects it.
		const forged = await signAccessToken(payload({ isAdmin: true }), wrongSecret);
		expect(await isRateLimitExempt(req(`Bearer ${forged}`), secret)).toBe(false);
	});

	it('does not exempt a structurally malformed token', async () => {
		expect(await isRateLimitExempt(req('Bearer not.a.jwt'), secret)).toBe(false);
	});
});
