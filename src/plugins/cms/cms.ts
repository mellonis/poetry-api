import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorRoutes } from './authorRoutes.js';
import { sectionRoutes } from './sectionRoutes.js';
import { sectionThingRoutes } from './sectionThingRoutes.js';
import { thingRoutes } from './thingRoutes.js';
import { searchCmsRoutes } from './searchCmsRoutes.js';
import { userRoutes } from './userRoutes.js';
import { commentsCmsRoutes } from './commentsCmsRoutes.js';

const requireEditorRole = async (request: FastifyRequest, reply: FastifyReply) => {
	if (!request.user?.isEditor) {
		return reply.code(403).send({ error: 'forbidden', message: 'Editor access required' });
	}
};

export async function cmsPlugin(fastify: FastifyInstance) {
	fastify.log.info('[PLUGIN] Registering: cms...');

	fastify.addHook('onRequest', fastify.verifyJwt);
	fastify.addHook('onRequest', requireEditorRole);

	fastify.register(authorRoutes);
	fastify.register(sectionRoutes);
	fastify.register(sectionThingRoutes);
	fastify.register(thingRoutes);
	fastify.register(searchCmsRoutes);
	fastify.register(userRoutes);
	fastify.register(commentsCmsRoutes);

	fastify.log.info('[PLUGIN] Registered: cms');
}
