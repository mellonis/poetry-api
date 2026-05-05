import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('actorFingerprint', () => {
	const TEST_KEY = 'test-key-do-not-use-in-prod-test-key-do-not-use-in-prod-padding';

	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv('LOG_HMAC_KEY_CURRENT', TEST_KEY);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('produces a 16-char lowercase hex digest', async () => {
		const { actorFingerprint } = await import('./actorFingerprint.js');
		const fp = actorFingerprint('123');
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
	});

	it('is deterministic for the same input + key', async () => {
		const { actorFingerprint } = await import('./actorFingerprint.js');
		expect(actorFingerprint('42')).toBe(actorFingerprint('42'));
	});

	it('produces different outputs for different inputs', async () => {
		const { actorFingerprint } = await import('./actorFingerprint.js');
		expect(actorFingerprint('1')).not.toBe(actorFingerprint('2'));
	});

	it('treats number and string inputs equivalently (String coercion)', async () => {
		const { actorFingerprint } = await import('./actorFingerprint.js');
		expect(actorFingerprint(123)).toBe(actorFingerprint('123'));
	});

	it('throws at module load if LOG_HMAC_KEY_CURRENT is unset', async () => {
		vi.unstubAllEnvs();
		vi.stubEnv('LOG_HMAC_KEY_CURRENT', '');
		await expect(import('./actorFingerprint.js')).rejects.toThrow(/LOG_HMAC_KEY_CURRENT/);
	});
});
