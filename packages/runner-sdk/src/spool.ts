import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SpoolRecord {
  sequence: number;
  payload: unknown;
}

export class EncryptedSpool {
  private readonly key: Buffer;

  constructor(key = randomBytes(32)) {
    if (key.length !== 32) throw new Error('Spool key must be 32 bytes');
    this.key = key;
  }

  seal(record: SpoolRecord): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(record), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  open(value: Buffer): SpoolRecord {
    const iv = value.subarray(0, 12);
    const tag = value.subarray(12, 28);
    const ciphertext = value.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    return JSON.parse(plaintext) as SpoolRecord;
  }
}
