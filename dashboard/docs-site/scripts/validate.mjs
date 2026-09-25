import { execSync } from 'node:child_process';

console.log('[docs-validate] Building documentation site...');
execSync('astro build', { stdio: 'inherit' });

console.log('[docs-validate] Checking internal links...');
execSync('linkinator ./dist --recurse --skip "https?://(?!localhost)"', {
  stdio: 'inherit',
});

console.log('[docs-validate] All checks passed.');
