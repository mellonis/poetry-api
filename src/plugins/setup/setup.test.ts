import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { MySQLPromisePool } from '@fastify/mysql';
import { setupPlugin } from './setup.js';

type QueryImpl = (sql: string, params?: unknown[]) => Promise<unknown>;

function mockMysql(queryImpl: QueryImpl): MySQLPromisePool {
  return {
    getConnection: vi.fn().mockImplementation(() => Promise.resolve({
      query: vi.fn().mockImplementation(queryImpl),
      release: vi.fn(),
    })),
  } as unknown as MySQLPromisePool;
}

function unreachableMysql(): MySQLPromisePool {
  return {
    getConnection: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
  } as unknown as MySQLPromisePool;
}

async function buildApp(mysql: MySQLPromisePool) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('mysql', mysql);
  await app.register(rateLimit, { global: false });
  await app.register(setupPlugin);
  return app;
}

describe('GET /setup/status', () => {
  beforeEach(() => { delete process.env.INITIAL_ADMIN_PASSWORD; });
  afterEach(() => { delete process.env.INITIAL_ADMIN_PASSWORD; });

  it('fresh DB, no admins, secret unset → needs_setup:true', async () => {
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('FROM auth_user LIMIT 1')) return [[{}], []];
      if (sql.includes('SELECT display_name')) return [[], []];
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 0 }], []];
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/setup/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      schema: { db_reachable: true, auth_user_table: true, display_name_col: true },
      has_active_admins: false,
      setup_secret_configured: false,
      needs_setup: true,
    });
    await app.close();
  });

  it('active admin exists → has_active_admins:true, needs_setup:false', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('FROM auth_user LIMIT 1')) return [[{}], []];
      if (sql.includes('SELECT display_name')) return [[], []];
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 1 }], []];
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/setup/status' });

    expect(res.json()).toMatchObject({
      has_active_admins: true,
      setup_secret_configured: true,
      needs_setup: false,
    });
    await app.close();
  });

  it('schema missing (42S02 on auth_user) → schema flags false, needs_setup:true', async () => {
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('FROM auth_user LIMIT 1')) {
        const err: NodeJS.ErrnoException & { code: string } = Object.assign(
          new Error("Table 'poetry.auth_user' doesn't exist"),
          { code: 'ER_NO_SUCH_TABLE' }
        );
        throw err;
      }
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/setup/status' });

    expect(res.json()).toMatchObject({
      schema: { db_reachable: true, auth_user_table: false, display_name_col: false },
      has_active_admins: false,
      needs_setup: true,
    });
    await app.close();
  });

  it('schema partial: auth_user exists but display_name column missing → display_name_col:false', async () => {
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('FROM auth_user LIMIT 1')) return [[{}], []];
      if (sql.includes('SELECT display_name')) {
        const err = Object.assign(
          new Error("Unknown column 'display_name'"),
          { code: 'ER_BAD_FIELD_ERROR' }
        );
        throw err;
      }
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 0 }], []];
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/setup/status' });

    expect(res.json()).toMatchObject({
      schema: { db_reachable: true, auth_user_table: true, display_name_col: false },
      has_active_admins: false,
      needs_setup: true,
    });
    await app.close();
  });

  it('db unreachable → db_reachable:false', async () => {
    const mysql = unreachableMysql();
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'GET', url: '/setup/status' });

    expect(res.json()).toMatchObject({
      schema: { db_reachable: false, auth_user_table: false, display_name_col: false },
      needs_setup: true,
    });
    await app.close();
  });
});

describe('POST /setup/admin', () => {
  beforeEach(() => { delete process.env.INITIAL_ADMIN_PASSWORD; });
  afterEach(() => { delete process.env.INITIAL_ADMIN_PASSWORD; });

  const validBody = { secret: 'test-secret', email: 'a@b.test', password: 'pass1234' };

  it('returns 503 when INITIAL_ADMIN_PASSWORD is not set', async () => {
    const mysql = mockMysql(async () => [[], []]);
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'POST', url: '/setup/admin', payload: validBody });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'setup_disabled' });
    await app.close();
  });

  it('returns 409 when active admin already exists', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 1 }], []];
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'POST', url: '/setup/admin', payload: validBody });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already_initialized' });
    await app.close();
  });

  it('returns 401 on secret mismatch', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'real-secret';
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 0 }], []];
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({
      method: 'POST',
      url: '/setup/admin',
      payload: { ...validBody, secret: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'wrong_secret' });
    await app.close();
  });

  it('returns 400 on bad email format', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    const mysql = mockMysql(async () => [[], []]);
    const app = await buildApp(mysql);

    const res = await app.inject({
      method: 'POST',
      url: '/setup/admin',
      payload: { ...validBody, email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation' });
    expect(res.json().issues).toBeInstanceOf(Array);
    await app.close();
  });

  it('returns 400 on short password (< 6)', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    const mysql = mockMysql(async () => [[], []]);
    const app = await buildApp(mysql);

    const res = await app.inject({
      method: 'POST',
      url: '/setup/admin',
      payload: { ...validBody, password: '12345' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation' });
    expect(res.json().issues).toBeInstanceOf(Array);
    await app.close();
  });

  it('returns 400 on missing secret', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    const mysql = mockMysql(async () => [[], []]);
    const app = await buildApp(mysql);

    const res = await app.inject({
      method: 'POST',
      url: '/setup/admin',
      payload: { email: 'a@b.test', password: 'pass1234' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation' });
    expect(res.json().issues).toBeInstanceOf(Array);
    await app.close();
  });

  it('returns 201 + creates row on valid request', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    let insertCalled = false;
    let insertEmail = '';
    let insertHash = '';
    const mysql = mockMysql(async (sql, params) => {
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 0 }], []];
      if (sql.includes('INSERT INTO auth_user')) {
        insertCalled = true;
        insertHash = (params as unknown[])[0] as string;
        insertEmail = (params as unknown[])[1] as string;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'POST', url: '/setup/admin', payload: validBody });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 1 });
    expect(insertCalled).toBe(true);
    expect(insertEmail).toBe('a@b.test');
    expect(insertHash).toMatch(/^\$2[ab]\$10\$/);
    await app.close();
  });

  it('returns 500 if INSERT throws', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'test-secret';
    const mysql = mockMysql(async (sql) => {
      if (sql.includes('SELECT EXISTS')) return [[{ has_active_admins: 0 }], []];
      if (sql.includes('INSERT INTO auth_user')) throw new Error('integrity violation');
      throw new Error(`unmocked: ${sql}`);
    });
    const app = await buildApp(mysql);

    const res = await app.inject({ method: 'POST', url: '/setup/admin', payload: validBody });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'insert_failed' });
    await app.close();
  });
});
