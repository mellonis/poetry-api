import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorResponse } from '../../lib/schemas.js';
import { authErrorResponse } from '../auth/schemas.js';
import { sendEmail } from '../../lib/email.js';
import { actorFingerprint } from '../../lib/actorFingerprint.js';
import { thingVotedEmail } from '../../lib/emailTemplates.js';
import { voteValueToDb } from '../../lib/voteValue.js';
import {
	upsertVote,
	deleteVote,
	getVoteSummary,
	getVoteSummaries,
	getVoteSummariesBySection,
	getThingTitle,
} from './databaseHelpers.js';
import {
	voteParams,
	voteRequest,
	voteSummaryResponse,
	voteListQuery,
	voteListResponse,
	type VoteParams,
	type VoteRequest,
	type VoteListQuery,
} from './schemas.js';

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;

export async function votesPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: votes...');

	fastify.get('/votes', {
		schema: {
			description: 'Batch fetch vote summaries (likes/dislikes counts + caller\'s own vote). Provide either `thingIds` (up to 100 thing ids) or `sectionId` (string identifier — covers every thing in that section, zero-filled for unvoted ones). Anonymous callers receive userVote: null.',
			tags: ['Votes'],
			querystring: voteListQuery,
			response: {
				200: voteListResponse,
				400: errorResponse,
				500: errorResponse,
			},
		},
		preHandler: fastify.optionalVerifyJwt,
		handler: async (request: FastifyRequest<{ Querystring: VoteListQuery }>, reply) => {
			try {
				const { thingIds, sectionId } = request.query;
				const userId = request.user?.sub ?? 0;

				if (sectionId !== undefined) {
					return await getVoteSummariesBySection(fastify.mysql, sectionId, userId);
				}

				// Schema guarantees `thingIds` is set when `sectionId` isn't.
				return await getVoteSummaries(fastify.mysql, thingIds!, userId);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.put('/:thingId/vote', {
		schema: {
			description: 'Cast, update, or remove a vote for a thing. vote=null removes. Returns the updated `{ likes, dislikes, userVote }` summary — same shape as the batch GET and the comment-vote endpoints.',
			tags: ['Votes'],
			params: voteParams,
			body: voteRequest,
			response: {
				200: voteSummaryResponse,
				401: authErrorResponse,
				403: authErrorResponse,
				500: errorResponse,
			},
		},
		preHandler: [fastify.verifyJwt, fastify.requireRight('canVote')],
		handler: async (request: FastifyRequest<{ Params: VoteParams; Body: VoteRequest }>, reply) => {
			try {
				const { thingId } = request.params;
				const { vote } = request.body;
				const dbVote = voteValueToDb(vote);
				const userId = request.user!.sub;
				const login = request.user!.login;

				if (dbVote === 0) {
					await deleteVote(fastify.mysql, thingId, userId);
					request.log.info({ thingId, actorFingerprint: actorFingerprint(userId) }, 'Vote removed');
				} else {
					await upsertVote(fastify.mysql, thingId, userId, dbVote);
					request.log.info({ thingId, actorFingerprint: actorFingerprint(userId), vote }, 'Vote recorded');
				}

				if (ADMIN_NOTIFY_EMAIL) {
					getThingTitle(fastify.mysql, thingId).then((title) => {
						sendEmail(ADMIN_NOTIFY_EMAIL, thingVotedEmail(login, title, dbVote));
					}).catch((err) => {
						request.log.warn(err, 'Vote notification email failed');
					});
				}

				return await getVoteSummary(fastify.mysql, thingId, userId);
			} catch (error) {
				request.log.error(error);
				return reply.code(500).send({ error: 'Internal server error' });
			}
		},
	});

	fastify.log.info('[PLUGIN] Registered: votes');
}
