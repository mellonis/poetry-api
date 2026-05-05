// Global test setup — runs before any module is loaded in test files.
// Provides a stable HMAC key so actorFingerprint.ts does not throw at module load.
// Individual tests that need to exercise the "throws when key is missing" path
// must call vi.resetModules() and use dynamic imports (see actorFingerprint.test.ts).
process.env.LOG_HMAC_KEY_CURRENT ??= 'test-key-do-not-use-in-prod-test-key-do-not-use-in-prod-padding';
