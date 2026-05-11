import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { MySQLPromisePool } from '@fastify/mysql';
import { healthPlugin } from './health.js';

function mockMysql(queryImpl: () => Promise<unknown>): MySQLPromisePool {
  return {
    getConnection: vi.fn().mockImplementation(() => Promise.resolve({
      query: queryImpl,
      release: vi.fn(),
    })),
  } as unknown as MySQLPromisePool;
}

function buildApp(mysql: MySQLPromisePool) {
  const app = Fastify({ logger: false });
  app.decorate('mysql', mysql);
  app.register(healthPlugin);
  return app;
}

describe('GET /health', () => {
  it('returns 200 with db=ok when SELECT 1 succeeds', async () => {
    const mysql = mockMysql(() => Promise.resolve([[{ '1': 1 }], []]));
    const app = buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });

    await app.close();
  });

  it('returns 200 with db=error when SELECT 1 throws', async () => {
    const mysql = mockMysql(() => Promise.reject(new Error('db unreachable')));
    const app = buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'error' });

    await app.close();
  });
});
