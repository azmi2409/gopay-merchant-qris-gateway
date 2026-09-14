import axios from 'axios';
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import {
  isExpired,
  generateUUID,
  getStandardGoBizHeaders,
  loadSession,
  loadSessionAsync,
  saveSession,
  refreshSession,
  SESSION_FILE,
  LEGACY_SESSION_FILE,
  DB_SESSION_KEY
} from '../src/services/sessionManager';
import { GoPaySession } from '../src/types/session';
import { initDatabase, getDatabase } from '../src/utils/db';

describe('Session Manager Expiry Detection', () => {
  it('should return true for null or missing tokens', () => {
    expect(isExpired(null)).toBe(true);
    expect(isExpired({ access_token: null } as any)).toBe(true);
    expect(isExpired({ access_token: 'valid', expires_at: null } as any)).toBe(true);
  });

  it('should return true for already expired timestamps', () => {
    const expiredSession: GoPaySession = {
      access_token: 'test_token',
      refresh_token: 'test_refresh',
      cookie: 'test_cookie',
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() - 1000).toISOString()
    };
    expect(isExpired(expiredSession)).toBe(true);
  });

  it('should return true when within the 5-minute buffer before expiration', () => {
    const nearExpirySession: GoPaySession = {
      access_token: 'test_token',
      refresh_token: 'test_refresh',
      cookie: 'test_cookie',
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString()
    };
    expect(isExpired(nearExpirySession)).toBe(true);
  });

  it('should return false for valid session well beyond the buffer', () => {
    const validSession: GoPaySession = {
      access_token: 'test_token',
      refresh_token: 'test_refresh',
      cookie: 'test_cookie',
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
    expect(isExpired(validSession)).toBe(false);
  });
});

describe('UUID and Header Generation', () => {
  it('should generate a valid UUID v4', () => {
    const uuid = generateUUID();
    expect(uuid).toHaveLength(36);
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
    ).toBe(true);
  });

  it('should generate headers containing standard GoBiz attributes', () => {
    const headers = getStandardGoBizHeaders('test-uuid-1234');
    expect(headers['x-uniqueid']).toBe('test-uuid-1234');
    expect(headers['x-appid']).toBe('go-biz-web-dashboard');
    expect(headers['authentication-type']).toBe('go-id');
    expect(headers['gojek-country-code']).toBe('ID');
  });
});

describe('Encrypted Session Persistence (gopay_session)', () => {
  let backupSession: string | null = null;
  beforeAll(async () => { await initDatabase(); });

  beforeEach(() => {
    if (fs.existsSync(SESSION_FILE)) {
      backupSession = fs.readFileSync(SESSION_FILE, 'utf-8');
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (backupSession !== null) {
      fs.writeFileSync(SESSION_FILE, backupSession, 'utf-8');
    } else if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  });

  it('should save encrypted session and decrypt faithfully on loadSession', () => {
    const testSession = {
      phone_number: '+628123456789',
      merchant_id: 'MID-999',
      outlet_name: 'Test Outlet',
      device_id: 'test-device-uuid',
      access_token: 'secret_jwt_token',
      refresh_token: 'secret_refresh_token',
      expires_in: 86400
    };

    saveSession(testSession);

    // Verify raw file is encrypted (colon-separated envelope, not plain json)
    const rawContent = fs.readFileSync(SESSION_FILE, 'utf-8');
    expect(rawContent).not.toContain('secret_jwt_token');
    expect(rawContent.split(':')).toHaveLength(3);

    // Verify loadSession decrypts correctly
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.access_token).toBe('secret_jwt_token');
    expect(loaded?.merchant_id).toBe('MID-999');
    expect(loaded?.phone_number).toBe('+628123456789');
    expect(loaded?.device_id).toBe('test-device-uuid');
  });

  it('should restore session from database when session file is absent (stateless/serverless)', async () => {
    process.env.DATABASE_URL = 'file::memory:';
    await initDatabase();

    const statelessSession = {
      phone_number: '+628999888777',
      merchant_id: 'MID-STATELESS',
      outlet_name: 'Stateless Outlet',
      access_token: 'token_from_db_store',
      refresh_token: 'refresh_from_db_store',
      expires_in: 86400
    };

    saveSession(statelessSession);

    // Remove local file to simulate cold start on fresh serverless container
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }

    const loadedAsync = await loadSessionAsync();
    expect(loadedAsync).not.toBeNull();
    expect(loadedAsync?.access_token).toBe('token_from_db_store');
    expect(loadedAsync?.merchant_id).toBe('MID-STATELESS');

    // Confirm database row exists and is encrypted
    const db = getDatabase();
    const rows = await db.execute({
      sql: `SELECT data FROM app_sessions WHERE key = ?`,
      args: [DB_SESSION_KEY]
    });
    expect(rows.rows.length).toBe(1);
    expect(String(rows.rows[0].data)).not.toContain('token_from_db_store');
  });

  it('should preserve original device_id when refreshing token', async () => {
    saveSession({
      phone_number: '+628123456789',
      merchant_id: 'MID-123',
      device_id: 'original-unique-device-id-123',
      access_token: 'old_access_token',
      refresh_token: 'valid_refresh_token',
      expires_in: 3600
    });

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {
        data: {
          access_token: 'new_refreshed_access_token',
          refresh_token: 'new_refreshed_refresh_token',
          expires_in: 7200
        }
      }
    });

    const refreshed = await refreshSession();
    expect(refreshed).not.toBeNull();
    expect(refreshed?.access_token).toBe('new_refreshed_access_token');
    expect(refreshed?.device_id).toBe('original-unique-device-id-123');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][2]?.headers?.['x-uniqueid']).toBe('original-unique-device-id-123');
  });

  it('does not refresh legacy sessions without the original device ID', async () => {
    saveSession({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 });
    const post = vi.spyOn(axios, 'post');
    expect(await refreshSession()).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
