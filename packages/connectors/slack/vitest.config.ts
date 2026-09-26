import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../../vitest.shared.js';
export default defineConfig({
  test: { environment: 'node', globals: true, coverage: standardCoverage(process.cwd()) },
});
