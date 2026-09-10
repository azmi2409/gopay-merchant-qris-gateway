import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, initDatabase } from '../src/utils/db';

describe('Database (LibSQL / Cloudflare D1 / SQLite)', () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = 'file::memory:';
    await initDatabase();
  });

  it('creates tables and executes queries successfully', async () => {
    const db = getDatabase();
    await db.execute({
      sql: `INSERT INTO qris (id, amount, data, reference, attributes, created_at, expires_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'qris_db_test',
        75000,
        '000201...',
        'REF-999',
        JSON.stringify({ note: 'order test' }),
        new Date().toISOString(),
        new Date().toISOString(),
        'PENDING'
      ]
    });

    const res = await db.execute({
      sql: 'SELECT * FROM qris WHERE id = ?',
      args: ['qris_db_test']
    });

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].reference).toBe('REF-999');
    expect(JSON.parse(String(res.rows[0].attributes))).toEqual({ note: 'order test' });
  });
});
