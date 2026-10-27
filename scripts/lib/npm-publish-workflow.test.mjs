import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  publicPackages,
  publishArguments,
  publishProblems,
  workspacePackages,
} from './npm-publish.mjs';

/**
 * `.github/workflows/npm-publish.yml`, and the package.json fields it depends on.
 *
 * `gate-tooling.test.mjs` already audits every workflow for a timeout and a concurrency
 * block. This holds the publish workflow to least privilege and pinned actions, and holds
 * every public package to what a published package needs.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEXT = readFileSync(
  path.join(REPO_ROOT, '.github/workflows/npm-publish.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

test('it runs on v* tags only, reads by default, and only the publish job mints a token', () => {
  assert.match(TEXT, /^on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n/m);
  assert.doesNotMatch(TEXT, /^ {2}(pull_request|workflow_dispatch|schedule):/m);
  assert.match(TEXT, /^permissions:\n {2}contents: read\n/m);
  assert.match(TEXT, /\n {4}permissions:\n {6}contents: read\n {6}id-token: write\n/);
  assert.equal([...TEXT.matchAll(/id-token: write/g)].length, 1);
});

test('every third-party action is pinned to a commit', () => {
  const uses = [...TEXT.matchAll(/uses: (\S+)/g)].map((match) => match[1] ?? '');
  assert.ok(uses.length >= 3);
  for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, ref);
});

test('the token is read in one step and a missing token is a recorded gap, not a pass', () => {
  assert.equal([...TEXT.matchAll(/secrets\.NPM_TOKEN/g)].length, 1);
  assert.match(TEXT, /GAP npm: no NPM_TOKEN secret/);
});

test('the CLI is public, and every public package can be published', () => {
  const published = publicPackages(workspacePackages(REPO_ROOT));
  assert.ok(
    published.some((pkg) => pkg.name === '@automate/cli'),
    'the CLI is what CI installs; it has to be public',
  );
  assert.ok(
    published.some((pkg) => pkg.name === '@automate/playwright-reporter'),
    'the live reporter is installed from a playwright.config.ts; it has to be public',
  );
  assert.deepEqual(published.flatMap(publishProblems), []);
});

test('the policy can fail: an unprepared public package is refused', () => {
  const problems = publishProblems({
    dir: 'tools/x',
    name: '@automate/x',
    manifest: { name: '@automate/x', dependencies: { '@automate/y': 'workspace:*' } },
  });
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /files/);
  assert.match(problems.join('\n'), /repository/);
  assert.match(problems.join('\n'), /provenance/);
  assert.match(problems.join('\n'), /workspace package @automate\/y/);
});

test('a prerelease is never published as latest', () => {
  assert.deepEqual(publishArguments({ prerelease: true }).slice(-2), ['--tag', 'next']);
  assert.deepEqual(publishArguments({ prerelease: false }).slice(-2), ['--tag', 'latest']);
  assert.ok(publishArguments({ prerelease: false }).includes('--provenance'));
});
