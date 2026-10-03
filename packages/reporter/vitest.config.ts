import { defineConfig } from 'vitest/config';
import { standardVitestConfig } from '../../vitest.shared.js';

// The whole configuration, and nothing local to it. See `standardVitestConfig`
// for why a copy of this file is five places a change has to be made.
export default defineConfig(standardVitestConfig(process.cwd()));
