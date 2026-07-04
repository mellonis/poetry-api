import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from './jwt.js';

/**
 * Predicate for the global rate-limit `allowList`: returns true only for a
 * request carrying a signature-verified access token belonging to an editor
 * or admin, so trusted staff bypass throttling.
 *
 * The signature MUST be verified, not just decoded. Some rate-limited routes
 * never run verifyJwt (e.g. POST /setup/admin, gated only by a body secret),
 * so a forged "isAdmin: true" payload would otherwise skip the limiter and
 * keep brute-forcing. Verifying here makes the exemption trustworthy on its
 * own, regardless of whether the route later runs verifyJwt.
 */
export async function isRateLimitExempt(
	request: Pick<FastifyRequest, 'headers'>,
	secret: Uint8Array,
): Promise<boolean> {
	const auth = request.headers.authorization;

	if (!auth?.startsWith('Bearer ')) return false;

	try {
		const payload = await verifyAccessToken(auth.substring(7), secret);

		return payload.isEditor === true || payload.isAdmin === true;
	} catch {
		return false;
	}
}
