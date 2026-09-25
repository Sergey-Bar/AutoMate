import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];
const findings = [];
for (const file of files) {
  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|wasm|db|sqlite)$/i.test(file)) continue;
  let text;
  try {
    text = readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue;
  }
  for (const pattern of patterns) if (pattern.test(text)) findings.push(file);
}
if (findings.length > 0) {
  console.error('Secret scan failed');
  for (const file of [...new Set(findings)]) console.error(`- ${file}`);
  process.exit(1);
}
console.log('Secret scan passed');
