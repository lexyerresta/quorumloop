import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

export interface SecretBox {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/**
 * Forge tokens and similar credentials are encrypted with AES-256-GCM before hitting the
 * database. The key lives in the environment or a mounted secret file, never in the row.
 */
export const createSecretBox = (base64Key: string): SecretBox => {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  }
  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        VERSION,
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted.toString('base64'),
      ].join(':');
    },
    decrypt(payload: string): string {
      const [version, ivB64, tagB64, dataB64] = payload.split(':');
      if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
        throw new Error('unsupported or malformed encrypted value');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
};

/** Generates a ready to use key for `pnpm setup` and documentation. */
export const generateSecretKey = (): string => randomBytes(32).toString('base64');
