import { createHmac } from 'node:crypto';

const key = process.env.LOG_HMAC_KEY_CURRENT;

if (!key) {
	throw new Error('LOG_HMAC_KEY_CURRENT not set — required for privacy-safe logging');
}

export function actorFingerprint(id: string | number): string {
	return createHmac('sha256', key as string).update(String(id)).digest('hex').slice(0, 16);
}
