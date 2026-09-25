import { timingSafeEqual } from 'node:crypto';

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform dummy comparison to maintain constant time
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function validateApiKey(provided: string, storedHash: string): boolean {
  return safeCompare(provided, storedHash);
}

export function validateServiceKey(provided: string, expected: string): boolean {
  return safeCompare(provided, expected);
}
