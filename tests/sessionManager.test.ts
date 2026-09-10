import { describe, it, expect } from 'vitest';
import {
  isExpired,
  generateUUID,
  getStandardGoBizHeaders,
  EXPIRY_BUFFER_MS
} from '../src/services/sessionManager';
import { GoPaySession } from '../src/types/session';

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
      // 2 minutes in future is less than the 5-minute buffer
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
      // 1 hour in future
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
    expect(isExpired(validSession)).toBe(false);
  });
});

describe('UUID and Header Generation', () => {
  it('should generate a valid UUID v4', () => {
    const uuid = generateUUID();
    expect(uuid).toHaveLength(36);
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)).toBe(
      true
    );
  });

  it('should generate headers containing standard GoBiz attributes', () => {
    const headers = getStandardGoBizHeaders('test-uuid-1234');
    expect(headers['x-uniqueid']).toBe('test-uuid-1234');
    expect(headers['x-appid']).toBe('go-biz-web-dashboard');
    expect(headers['authentication-type']).toBe('go-id');
    expect(headers['gojek-country-code']).toBe('ID');
  });
});
