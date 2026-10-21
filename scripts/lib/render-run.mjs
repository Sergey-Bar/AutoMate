/**
 * Run the rendering budget against the bundle that ships, not the dev server.
 *
 * Both `pnpm test:render` and `pnpm render:baseline` come through here. The first
 * measurement on the reference install (2026-10-21) read 8952 ms of LCP on
 * `/dashboard` and 264–284 ms on the next three routes: the first route paid for
 * Vite's dev server compiling the application on demand. The dev build is also
 * unminified React with development checks, so even warm it describes a program
 * nobody runs. A ceiling recorded from that would be a ceiling on the tooling.
 *
 * So the web bundle is built **here, before Playwright starts**, and
 * `playwright.config.ts` serves it with `vite preview` when
 * `AUTOMATE_RENDER_SERVE=preview` is set. Building here rather than in the web
 * server's command is deliberate: Playwright starts both web servers at once, and the
 * API's server command rebuilds the shared workspace packages, so a build in the web
 * command would race it for the same `dist/` directories.
 *
 * The `rendering-budget` project only exists in that mode, so a plain
 * `pnpm test:e2e` does not measure it against the dev server and compare the result
 * with ceilings that were recorded against the bundle.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

/** The value `playwright.config.ts` reads to serve the built bundle. */
export const RENDER_SERVE_ENV = 'AUTOMATE_RENDER_SERVE';

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
function step(label, command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  if (result.error !== undefined) {
    console.error(`${label}: could not start.`);
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Build the web bundle and its workspace dependencies, then run the budget project.
 *
 * @param {NodeJS.ProcessEnv} [extraEnv] added to the Playwright run, e.g. the baseline writer's switch
 * @returns {number} the exit status of the first step that failed, or 0
 */
export function runRenderBudget(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, [RENDER_SERVE_ENV]: 'preview' };
  const built = step(
    'render: web build',
    'pnpm',
    ['--filter', '@automate/unified-web...', 'build'],
    env,
  );
  if (built !== 0) return built;
  return step(
    'render: playwright',
    'npx',
    ['playwright', 'test', '--project=rendering-budget'],
    env,
  );
}
