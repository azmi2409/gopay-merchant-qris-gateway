import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { getMasterKey, encryptPayload, decryptPayload } from '../src/utils/crypto';

describe('Rails-style Master Key Crypto (AES-256-GCM)', () => {
  const customKey = crypto.randomBytes(32);

  it('should generate a 32-byte master key', () => {
    const key = getMasterKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('should encrypt and decrypt an object payload faithfully', () => {
    const original = {
      phone_number: '+6285119772671',
      merchant_id: 'M-12345',
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_at: '2026-09-10T18:00:00.000Z'
    };

    const envelope = encryptPayload(original, customKey);
    expect(typeof envelope).toBe('string');
    expect(envelope.split(':')).toHaveLength(3); // iv:authTag:ciphertext

    const decrypted = decryptPayload<typeof original>(envelope, customKey);
    expect(decrypted).toEqual(original);
  });

  it('should encrypt and decrypt plain strings', () => {
    const message = 'Hello GoPay Secret Token';
    const envelope = encryptPayload(message, customKey);
    const decrypted = decryptPayload<string>(envelope, customKey);
    expect(decrypted).toBe(message);
  });

  it('should detect tampering and fail decryption if ciphertext or auth tag is modified', () => {
    const envelope = encryptPayload({ sensitive: 'credit_card' }, customKey);
    const [iv, authTag, ciphertext] = envelope.split(':');

    // Tamper with the last character of ciphertext
    const tamperedCiphertext =
      ciphertext.slice(0, -2) + (ciphertext.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedEnvelope = `${iv}:${authTag}:${tamperedCiphertext}`;

    expect(() => decryptPayload(tamperedEnvelope, customKey)).toThrow();
  });

  it('should throw when decrypting with the wrong master key', () => {
    const wrongKey = crypto.randomBytes(32);
    const envelope = encryptPayload({ secret: 'data' }, customKey);

    expect(() => decryptPayload(envelope, wrongKey)).toThrow();
  });

  it('should throw on invalid envelope format', () => {
    expect(() => decryptPayload('invalid_envelope_without_colons', customKey)).toThrow(
      'Invalid encrypted envelope format'
    );
  });
});
