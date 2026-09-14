import fs from 'fs';
import path from 'path';
import { createClient, Client } from '@libsql/client';
import { logger } from './logger';

export interface DatabaseAdapter {
  execute(query: { sql: string; args?: any[] } | string): Promise<{ rows: any[] }>;
  close?(): void;
}

let dbInstance: Client | null = null;

export function getDatabase(): Client {
  if (dbInstance) return dbInstance;

  const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'data', 'gateway.db')}`;
  const authToken = process.env.DATABASE_AUTH_TOKEN;

  // Ensure local file folder exists if using local file
  if (dbUrl.startsWith('file:') && !dbUrl.includes(':memory:')) {
    const filePath = dbUrl.replace(/^file:/, '');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  dbInstance = createClient({
    url: dbUrl,
    authToken
  });

  logger.info(`Database initialized with URL target: ${dbUrl}`);
  return dbInstance;
}

export async function initDatabase(client = getDatabase()): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS qris (
      id TEXT PRIMARY KEY,
      trx_id TEXT,
      amount INTEGER NOT NULL,
      data TEXT NOT NULL,
      reference TEXT,
      attributes TEXT,
      callback_url TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL,
      transaction_json TEXT
    );
  `);

  try {
    await client.execute(`ALTER TABLE qris ADD COLUMN callback_url TEXT;`);
  } catch (error: any) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }

  try {
    await client.execute('ALTER TABLE qris ADD COLUMN unique_code INTEGER NOT NULL DEFAULT 0');
  } catch (error: any) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS claimed_transactions (
      tx_id TEXT PRIMARY KEY,
      qris_id TEXT,
      claimed_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_qris_status ON qris (status);
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_qris_reference ON qris (reference);
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_qris_created_at ON qris (created_at);
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs (timestamp);
  `);
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
