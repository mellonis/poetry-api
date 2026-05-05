// Fixture: this file MUST be flagged by the CI guard. It contains a forbidden
// pattern (raw `userId` as a shorthand property in a `request.log.*` call).
// The CI guard scans all of src/, and `__tests__/__fixtures__/` is intentionally
// NOT excluded — the guard must catch this file. This is the regex's self-test:
// if it ever stops catching this fixture, the regex is silently broken and the
// guard becomes useless.
//
// No runtime side-effects: the IIFE returns null and stores it in a const.
type LogShape = { log: { info: (obj: object, msg: string) => void } };

export const FORBIDDEN_SAMPLE = ((): null => {
	const request: LogShape = { log: { info: () => {} } };
	const userId = 1;
	request.log.info({ userId }, 'Forbidden: raw userId as shorthand property');
	return null;
})();
