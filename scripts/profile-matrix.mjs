/**
 * `pnpm test:e2e:profiles` — the four deployment profiles, each booted from the API's own entry
 * point against PostgreSQL (`tests/e2e/profiles/profile-matrix.spec.ts`, plan task 19).
 *
 * A wrapper rather than a bare `playwright test --project=profile-matrix`, because that project
 * exists only with `AUTOMATE_PROFILE_MATRIX=1` (`playwright.config.ts`): a plain `pnpm test:e2e`
 * runs every project, and the matrix is `pr-reporting` until it has three stable runs, so it
 * must not ride in the required Product E2E job before then. An environment variable set inside
 * a package script is not portable across shells; set here, it is.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const result = spawnSync('npx', ['playwright', 'test', '--project=profile-matrix'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AUTOMATE_PROFILE_MATRIX: '1' },
});
if (result.error !== undefined) {
  console.error(`profile matrix: playwright could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
