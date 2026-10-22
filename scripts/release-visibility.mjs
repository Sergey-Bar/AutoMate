#!/usr/bin/env node
/**
 * `pnpm release:visibility --tag v2.5.0` — can a stranger pull every release image?
 *
 * Asks GHCR anonymously for each published image's manifest at the release version and
 * fails, with the settings link for each private package, if any refuses. See
 * `scripts/lib/registry-visibility.mjs` for why this cannot be fixed from a workflow.
 */

import { anonymousPull, visibilityProblems } from './lib/registry-visibility.mjs';
import { parseTag } from './lib/release-notes.mjs';
import { PUBLISHED_IMAGES } from './lib/release-compose.mjs';

const OWNER = 'sergey-bar';

/** @param {string} flag @returns {string | undefined} */
function option(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const { version } = parseTag(option('--tag') ?? process.env['GITHUB_REF_NAME'] ?? '');
const checks = await Promise.all(
  PUBLISHED_IMAGES.map((service) => anonymousPull(OWNER, `automate-${service}`, version)),
);
for (const check of checks)
  console.log(
    `${check.status === 200 ? 'public ' : 'REFUSED'} automate image ${check.image}: ${String(check.status)}`,
  );
const problems = visibilityProblems(OWNER, checks);
if (problems.length > 0) {
  console.error(
    `release:visibility: ${String(problems.length)} image(s) cannot be pulled anonymously:\n- ${problems.join('\n- ')}`,
  );
  process.exit(1);
}
console.log(
  `release:visibility: all ${String(checks.length)} images can be pulled without signing in.`,
);
