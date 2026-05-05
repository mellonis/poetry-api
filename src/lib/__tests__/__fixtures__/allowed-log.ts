// Fixture: this file must NOT be flagged by the CI guard. It uses the
// migrated pattern (actorFingerprint instead of raw userId). If the guard
// ever flags this file, the regex has a false-positive bug.
import { actorFingerprint } from '../../actorFingerprint.js';

type LogShape = { log: { info: (obj: object, msg: string) => void } };

export const ALLOWED_SAMPLE = ((): null => {
	const request: LogShape = { log: { info: () => {} } };
	const userId = 1;
	request.log.info({ actorFingerprint: actorFingerprint(userId) }, 'Allowed: migrated pattern');
	return null;
})();
