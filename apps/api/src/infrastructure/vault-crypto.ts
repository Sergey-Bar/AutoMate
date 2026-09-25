import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

export interface VaultEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  keyVersion: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function keyFor(secret: string, salt: string): Buffer {
  if (secret.length < 32) throw new Error('Vault secret must be at least 32 characters');
  return pbkdf2Sync(secret, salt, 100_000, 32, 'sha256');
}

export function sealSecret(plaintext: string, secret: string, keyVersion = 1): VaultEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt.toString('base64url')), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    keyVersion,
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function openSecret(envelope: VaultEnvelope, secret: string): string {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm')
    throw new Error('Unsupported vault envelope');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(secret, envelope.salt),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export interface SecretProvider {
  getSecret(reference: string, signal?: AbortSignal): Promise<string>;
}
