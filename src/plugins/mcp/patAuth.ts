import type { FastifyBaseLogger } from 'fastify';
import type { MySQLPromisePool } from '@fastify/mysql';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { hashToken } from '../auth/jwt.js';
import { isPersonalAccessToken } from '../auth/pat/token.js';
import { effectiveLevel, resolveAccountLevel } from '../auth/pat/scope.js';
import { findPersonalAccessTokenWithUser } from '../auth/pat/databaseHelpers.js';
import type { McpCaller } from './principal.js';

export type McpAuthResult =
	| { ok: true; caller: McpCaller }
	| { ok: false; status: 401; body: { error: 'unauthorized'; message: string } };

const reject = (message: string): McpAuthResult => ({ ok: false, status: 401, body: { error: 'unauthorized', message } });

// /mcp accepts personal access tokens only. No header means anonymous (public
// tools); anything that is not a valid, live PAT of a non-banned account is 401.
export const authenticateMcpCaller = async (
	mysql: MySQLPromisePool,
	authorization: string | undefined,
	log: FastifyBaseLogger,
): Promise<McpAuthResult> => {
	if (!authorization) {
		return { ok: true, caller: { kind: 'anonymous' } };
	}

	if (!authorization.startsWith('Bearer ')) {
		log.warn('MCP auth failed: malformed Authorization header');
		return reject('Missing or invalid Authorization header');
	}

	const token = authorization.substring(7);

	if (!isPersonalAccessToken(token)) {
		log.warn('MCP auth failed: non-PAT bearer');
		return reject('The MCP endpoint accepts personal access tokens only');
	}

	const row = await findPersonalAccessTokenWithUser(mysql, hashToken(token));

	if (!row) {
		log.warn('MCP auth failed: unknown token');
		return reject('Invalid or revoked token');
	}

	const account = resolveAccountLevel(row);

	if (account.banned) {
		log.warn({ actorFingerprint: actorFingerprint(row.userId), tokenId: row.tokenId }, 'MCP auth failed: account banned');
		return reject('Account is banned');
	}

	return {
		ok: true,
		caller: {
			kind: 'token',
			principal: {
				userId: row.userId,
				login: row.login,
				tokenId: row.tokenId,
				tokenVersion: row.tokenVersion,
				level: effectiveLevel(row.scope, account),
				isAdmin: account.isAdmin,
				isEditor: account.isEditor,
				rights: account.rights,
			},
		},
	};
};
