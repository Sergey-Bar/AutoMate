import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';

test.prop([fc.integer()])('canary: integer is a number', (n) => {
  expect(typeof n).toBe('number');
});
