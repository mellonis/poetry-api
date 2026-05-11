import type { FastifyInstance } from 'fastify';

export async function healthPlugin(fastify: FastifyInstance) {
  fastify.get(
    '/health',
    { config: { rateLimit: false } },
    async (request, reply) => {
      let db: 'ok' | 'error' = 'ok';
      try {
        const conn = await fastify.mysql.getConnection();
        try {
          await conn.query('SELECT 1');
        } finally {
          conn.release();
        }
      } catch (err) {
        db = 'error';
        request.log.warn({ err }, 'health: db probe failed');
      }
      return reply.code(200).send({ status: 'ok', db });
    }
  );
}
