import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Which workspace packages are published to npm, and how.
 *
 * **The list is the package.json files.** A package is public exactly when it does not
 * say `"private": true`, so there is no second list to fall out of step with them. A
 * public package must also say what it ships (`files`), where its source is
 * (`repository`), and that it is published with provenance — a package that is public by
 * accident is the defect this refuses.
 */

/**
 * @typedef {{ dir: string, name: string, manifest: Record<string, unknown> }} WorkspacePackage
 */

/**
 * @param {string} root the repository root
 * @returns {WorkspacePackage[]} every tracked workspace package, root excluded
 */
export function workspacePackages(root) {
  return execFileSync('git', ['ls-files', '--', '**/package.json'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => line !== '' && !line.includes('node_modules/') && !line.startsWith('.config/'),
    )
    .map((file) => {
      const manifest = /** @type {Record<string, unknown>} */ (
        JSON.parse(readFileSync(path.join(root, file), 'utf8'))
      );
      return { dir: path.dirname(file), name: String(manifest['name']), manifest };
    });
}

/** @param {readonly WorkspacePackage[]} packages @returns {WorkspacePackage[]} */
export function publicPackages(packages) {
  return packages.filter((pkg) => pkg.manifest['private'] !== true);
}

/**
 * @param {WorkspacePackage} pkg
 * @returns {string[]} what is wrong with publishing this package, empty when nothing is
 */
export function publishProblems(pkg) {
  /** @type {string[]} */
  const problems = [];
  const m = pkg.manifest;
  if (!Array.isArray(m['files']) || m['files'].length === 0) {
    problems.push(`${pkg.name}: no "files" list, so the tarball would carry the whole directory`);
  }
  const repository = /** @type {Record<string, unknown> | undefined} */ (m['repository']);
  if (
    typeof repository?.['url'] !== 'string' ||
    repository['directory'] !== pkg.dir.replace(/\\/g, '/')
  ) {
    problems.push(`${pkg.name}: "repository" must name the url and directory "${pkg.dir}"`);
  }
  const publishConfig = /** @type {Record<string, unknown> | undefined} */ (m['publishConfig']);
  if (publishConfig?.['access'] !== 'public' || publishConfig['provenance'] !== true) {
    problems.push(`${pkg.name}: "publishConfig" must set access public and provenance true`);
  }
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = /** @type {Record<string, string> | undefined} */ (m[field]);
    for (const [dep, spec] of Object.entries(deps ?? {})) {
      // A workspace dependency of a published package must itself be published, or the
      // install resolves a name nobody can download.
      if (spec.startsWith('workspace:')) {
        problems.push(`${pkg.name}: ${field} names workspace package ${dep}`);
      }
    }
  }
  return problems;
}

/**
 * The `pnpm publish` arguments for a version: a prerelease goes to the `next` dist-tag so
 * it never becomes what `npm install` resolves.
 *
 * @param {{ prerelease: boolean }} version
 * @returns {string[]}
 */
export function publishArguments(version) {
  return [
    'publish',
    '--no-git-checks',
    '--access',
    'public',
    '--provenance',
    '--tag',
    version.prerelease ? 'next' : 'latest',
  ];
}
