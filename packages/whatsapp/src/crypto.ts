import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedValue {
  encryptedToken: string;
  iv: string;
  authTag: string;
}

export function encryptToken(plaintext: string, keyHex: string): EncryptedValue {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encryptedToken: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptToken(value: EncryptedValue, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(value.iv, 'hex');
  const authTag = Buffer.from(value.authTag, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value.encryptedToken, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
