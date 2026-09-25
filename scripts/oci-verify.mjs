import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['playwright', 'k6', 'zap'];
const failures = [];
for (const name of names) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'runners', name, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) failures.push(`${name}: schema`);
  if (manifest.user !== 65532) failures.push(`${name}: non-root user`);
  if (manifest.network !== 'none' || manifest.readOnly !== true) failures.push(`${name}: isolation`);
  if (!manifest.imageDigest || !/^sha256:[a-f0-9]{64}$/.test(manifest.imageDigest)) failures.push(`${name}: image digest not built`);
}
if (failures.length > 0) {
  console.error('OCI verification blocked');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('OCI manifests verified');
