import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  iterations: number;
}

export function deriveKey(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, 'sha256', (err, key) => {
      if (err) {
        reject(err);
      } else {
        resolve(key);
      }
    });
  });
}

export async function encryptSecret(password: string, plaintext: string): Promise<EncryptedSecret> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 100_000;
  const key = await deriveKey(password, salt, iterations);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
    iterations,
  };
}

export async function decryptSecret(password: string, encrypted: EncryptedSecret): Promise<string> {
  const key = await deriveKey(password, Buffer.from(encrypted.salt, 'base64'), encrypted.iterations);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return plain.toString('utf8');
}
