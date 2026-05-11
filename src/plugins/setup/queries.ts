import type { MySQLPromisePool } from '@fastify/mysql';
import type { RowDataPacket } from 'mysql2';
import { withConnection } from '../../lib/databaseHelpers.js';

export type SchemaProbe = {
  db_reachable: boolean;
  auth_user_table: boolean;
  display_name_col: boolean;
};

export async function probeSchema(mysql: MySQLPromisePool): Promise<SchemaProbe> {
  const result: SchemaProbe = {
    db_reachable: false,
    auth_user_table: false,
    display_name_col: false,
  };

  let conn;
  try {
    conn = await mysql.getConnection();
    result.db_reachable = true;
  } catch {
    return result;
  }

  try {
    await conn.query('SELECT 1 FROM auth_user LIMIT 1');
    result.auth_user_table = true;
  } catch {
    // 42S02 = table missing. Other errors leave auth_user_table false.
  }

  if (result.auth_user_table) {
    try {
      await conn.query('SELECT display_name FROM auth_user LIMIT 0');
      result.display_name_col = true;
    } catch {
      // 42S22 = column missing
    }
  }

  conn.release();
  return result;
}

export async function hasActiveAdmins(mysql: MySQLPromisePool): Promise<boolean> {
  return withConnection(mysql, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT EXISTS (
         SELECT 1 FROM auth_user u
         JOIN auth_group g ON u.r_group_id = g.id
         WHERE u.r_group_id = 1
           AND (u.rights & 4) = 0
           AND (g.rights & 4) = 0
       ) AS has_active_admins`
    );
    return Boolean(rows[0]?.has_active_admins);
  });
}

export async function insertInitialAdmin(
  mysql: MySQLPromisePool,
  email: string,
  passwordHash: string
): Promise<void> {
  return withConnection(mysql, async (conn) => {
    await conn.query(
      `INSERT INTO auth_user (id, login, password_hash, email, rights, r_group_id)
       VALUES (1, 'admin', ?, ?, 1, 1)`,
      [passwordHash, email]
    );
  });
}
