import type { FastifyInstance } from 'fastify';
import type { AccessTokenPayload } from './jwt.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './jwt.js';
import { resolveAccountRoles } from './rights.js';
import { createRefreshToken } from './databaseHelpers.js';

export const issueTokens = async (
	fastify: FastifyInstance,
	userId: number,
	login: string,
	userRights: number,
	groupRights: number,
	groupId: number,
	tokenVersion: number,
) => {
	const { rights, isAdmin, isEditor } = resolveAccountRoles(userRights, groupRights, groupId);
	const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

	const payload: AccessTokenPayload = { sub: userId, login, isAdmin, isEditor, tokenVersion, rights };
	const accessToken = await signAccessToken(payload, secret);
	const refreshToken = generateRefreshToken();

	await createRefreshToken(fastify.mysql, userId, hashRefreshToken(refreshToken));

	return { accessToken, refreshToken, user: { id: userId, login, isAdmin, isEditor, rights } };
};
