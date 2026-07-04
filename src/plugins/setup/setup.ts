import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { maskEmail } from '../../lib/maskEmail.js';
import {
  setupStatusResponseSchema,
  setupAdminBodySchema,
  setupAdminSuccessSchema,
  setupAdminErrorSchema,
  type SetupAdminBody,
} from './schemas.js';
import {
  probeSchema,
  hasActiveAdmins,
  insertInitialAdmin,
} from './queries.js';

const BCRYPT_COST = 10;

// Constant-time comparison of the setup secret. Both sides are hashed to
// equal-length digests first so timingSafeEqual never throws on a length
// mismatch and the comparison leaks neither the value nor its length.
const secretsMatch = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export async function setupPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((err, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: 'validation' as const, issues: err.validation });
    }
    return reply.send(err);
  });

  fastify.get(
    '/setup/status',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { response: { 200: setupStatusResponseSchema } },
    },
    async () => {
      const schema = await probeSchema(fastify.mysql);
      const hasAdmins = schema.auth_user_table
        ? await hasActiveAdmins(fastify.mysql)
        : false;
      const secretConfigured = Boolean(process.env.INITIAL_ADMIN_PASSWORD);
      const needsSetup = !schema.auth_user_table || !hasAdmins;

      return {
        schema,
        has_active_admins: hasAdmins,
        setup_secret_configured: secretConfigured,
        needs_setup: needsSetup,
      };
    }
  );

  fastify.post(
    '/setup/admin',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: setupAdminBodySchema,
        response: {
          201: setupAdminSuccessSchema,
          400: setupAdminErrorSchema,
          401: setupAdminErrorSchema,
          409: setupAdminErrorSchema,
          500: setupAdminErrorSchema,
          503: setupAdminErrorSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Body: SetupAdminBody }>, reply) => {
      const expected = process.env.INITIAL_ADMIN_PASSWORD;
      if (!expected) {
        return reply.code(503).send({ error: 'setup_disabled' as const });
      }

      if (await hasActiveAdmins(fastify.mysql)) {
        return reply.code(409).send({ error: 'already_initialized' as const });
      }

      if (!secretsMatch(request.body.secret, expected)) {
        request.log.warn('setup: secret mismatch');
        return reply.code(401).send({ error: 'wrong_secret' as const });
      }

      const passwordHash = await bcrypt.hash(request.body.password, BCRYPT_COST);
      try {
        await insertInitialAdmin(fastify.mysql, request.body.email, passwordHash);
      } catch (err) {
        request.log.error({ err }, 'setup: insert failed');
        return reply.code(500).send({ error: 'insert_failed' as const });
      }

      request.log.info(
        { email: maskEmail(request.body.email) },
        'setup: initial admin created'
      );
      return reply.code(201).send({ id: 1 as const });
    }
  );
}
