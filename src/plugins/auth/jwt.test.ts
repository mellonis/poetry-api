import { describe, expect, it, beforeEach, vi } from 'vitest';
import { signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken } from './jwt.js';

const secret = new TextEncoder().encode('test-secret-that-is-at-least-32-chars-long');

beforeEach(() => {
	vi.stubEnv('JWT_ACCESS_TOKEN_TTL', '900');
});

describe('JWT access tokens', () => {
	it('signs and verifies a token', async () => {
		const payload = {
			sub: 42,
			login: 'testuser',
			isAdmin: false,
			isEditor: true,
			tokenVersion: 1,
			rights: { canVote: true, canComment: true, canEditContent: false, canEditUsers: false },
		};

		const token = await signAccessToken(payload, secret);
		const decoded = await verifyAccessToken(token, secret);

		expect(decoded.sub).toBe(42);
		expect(decoded.login).toBe('testuser');
		expect(decoded.isAdmin).toBe(false);
		expect(decoded.isEditor).toBe(true);
		expect(decoded.tokenVersion).toBe(1);
		expect(decoded.rights).toEqual({ canVote: true, canComment: true, canEditContent: false, canEditUsers: false });
	});

	it('rejects a token with wrong secret', async () => {
		const payload = { sub: 1, login: 'user', isAdmin: false, isEditor: false, tokenVersion: 0, rights: { canVote: false, canComment: false, canEditContent: false, canEditUsers: false } };
		const token = await signAccessToken(payload, secret);
		const wrongSecret = new TextEncoder().encode('wrong-secret-that-is-at-least-32-chars-long');

		await expect(verifyAccessToken(token, wrongSecret)).rejects.toThrow();
	});
});

describe('refresh tokens', () => {
	it('generates a 64-char hex string', () => {
		const token = generateRefreshToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('generates unique tokens', () => {
		const a = generateRefreshToken();
		const b = generateRefreshToken();
		expect(a).not.toBe(b);
	});

	it('hashes to a 64-char hex string', () => {
		const token = generateRefreshToken();
		const hash = hashRefreshToken(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('produces consistent hashes', () => {
		const token = generateRefreshToken();
		expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
	});
});
