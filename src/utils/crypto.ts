import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const MASTER_KEY_FILE = path.join(process.cwd(), 'gopay.key');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard IV length for AES-GCM

/**
 * Retrieves the 256-bit master encryption key.
 *
 * Checks in order:
 * 1. GOPAY_MASTER_KEY environment variable (64 hex characters / 32 bytes)
 * 2. gopay.key file in the project root
 * 3. If neither exists, automatically generates a new 32-byte key, saves it
 *    to gopay.key with restricted permissions (0600), and returns the key buffer.
 */
export function getMasterKey(): Buffer {
  // 1. Environment Variable
  const envKey = process.env.GOPAY_MASTER_KEY?.trim();
  if (envKey) {
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    // Fallback: scrypt derivation if not exact 64-hex
    return crypto.scryptSync(envKey, 'gopay-salt-v1', 32);
  }

  // 2. Key File
  if (fs.existsSync(MASTER_KEY_FILE)) {
    try {
      const fileContent = fs.readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
      if (fileContent.length === 64) {
        return Buffer.from(fileContent, 'hex');
      }
      return crypto.scryptSync(fileContent, 'gopay-salt-v1', 32);
    } catch (err: any) {
      console.warn(`[Crypto] Failed to read ${MASTER_KEY_FILE}: ${err.message}`);
    }
  }

  // 3. Auto-generate new Master Key (Rails-style)
  const newKey = crypto.randomBytes(32);
  const hexKey = newKey.toString('hex');
  try {
    fs.writeFileSync(MASTER_KEY_FILE, hexKey + '\n', { mode: 0o600, encoding: 'utf-8' });
    console.log(`[Crypto] Generated new master key saved to ${MASTER_KEY_FILE} (0600)`);
  } catch (err: any) {
    console.error(`[Crypto] Failed to write master key to file: ${err.message}`);
  }
  return newKey;
}

/**
 * Encrypts an object or string using AES-256-GCM.
 * Format: iv_hex:auth_tag_hex:ciphertext_hex
 *
 * @param payload Object or string to encrypt
 * @param customKey Optional custom 32-byte Buffer key
 * @returns Serialized encrypted envelope
 */
export function encryptPayload(payload: unknown, customKey?: Buffer): string {
  const key = customKey || getMasterKey();
  const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts and parses an AES-256-GCM encrypted envelope.
 *
 * @param envelope String in the format iv_hex:auth_tag_hex:ciphertext_hex
 * @param customKey Optional custom 32-byte Buffer key
 * @returns Decrypted object or string
 */
export function decryptPayload<T = any>(envelope: string, customKey?: Buffer): T {
  const key = customKey || getMasterKey();
  const parts = envelope.trim().split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted envelope format (expected iv:authTag:ciphertext)');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return decrypted as unknown as T;
  }
}
