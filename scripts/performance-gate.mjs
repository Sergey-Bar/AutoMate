import { execFileSync } from 'node:child_process';

try {
  const version = execFileSync('k6', ['version'], { encoding: 'utf8' }).trim();
  console.info(`k6 available: ${version.split(/\r?\n/)[0]}`);
  console.info(
    'No customer-owned performance scenarios are registered; no synthetic pass is claimed.',
  );
  process.exit(1);
} catch {
  console.error('Performance gate blocked: k6 is not installed.');
  process.exit(1);
}
