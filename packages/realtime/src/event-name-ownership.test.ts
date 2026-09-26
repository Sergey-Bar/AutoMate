import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One declaration per canonical name.
 *
 * `@automate/shared-contracts` exported a reporter-event schema named
 * `ReporterEventSchema`, and `packages/realtime` exported a *different* one under
 * the same bare name: one an envelope with `contractVersion`/`eventId`/
 * `occurredAt` and a `data` payload, the other flat with colon-separated event
 * types and no envelope at all. A message valid under one was rejected by the
 * other, and nothing about the import was wrong at compile time — a consumer
 * that reached for the wrong one found out at runtime, on a live event.
 *
 * `packages/realtime`'s copy is now `FlatReporterEventSchema` /
 * `FlatRealtimeEventSchema`, and the contract is re-exported explicitly as
 * `ReporterContractEventSchema`. This test fails if a bare declaration of a
 * canonical name reappears anywhere outside the contract package.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const CANONICAL_NAMES = [
  'ReporterEventSchema',
  'RealtimeEventSchema',
  'CanonicalReporterEventSchema',
  'RunEventEnvelopeSchema',
];

/**
 * Declares the name, as opposed to importing or re-exporting it.
 *
 * The `g` flag is load-bearing: `matchAll` throws on a non-global regex, so a
 * check that iterates inside a `try` finds nothing and passes. That is the exact
 * failure this gate exists to prevent, and it happened here first.
 */
const DECLARATION = new RegExp(
  [
    `export\\s+const\\s+(${CANONICAL_NAMES.join('|')})\\s*=`,
    `(?:^|\\n)\\s*const\\s+(${CANONICAL_NAMES.join('|')})\\s*=`,
    `\\b(?:const|let|var)\\s+(${CANONICAL_NAMES.join('|')})\\s*=\\s*z\\.`,
  ].join('|'),
  'g',
);

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|mjs)$/;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.kilo',
  '.turbo',
  'blob-report',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'var',
]);

function sourceFiles(directory: string): string[] {
  const stats = statSync(directory, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (
      SOURCE_EXTENSIONS.test(entry.name) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      found.push(full);
    }
  }
  return found;
}

/** Every canonical name declared outside the contract package. */
function offenders(): string[] {
  const declared = new Map<string, string[]>();
  for (const directory of ['apps', 'packages', 'tools', 'tests']) {
    for (const file of sourceFiles(path.join(repoRoot, directory))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DECLARATION)) {
        const name = match[1] ?? match[2] ?? match[3];
        if (name === undefined) continue;
        const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
        declared.set(name, [...(declared.get(name) ?? []), relative]);
      }
    }
  }
  const found: string[] = [];
  for (const [name, files] of declared) {
    const outside = files.filter((file) => !file.startsWith('packages/shared-contracts/'));
    if (outside.length > 0) {
      found.push(`${name} is declared outside the contract package: ${outside.join(', ')}`);
    }
  }
  return found;
}

describe('canonical event schema names', () => {
  it('finds the source files it is meant to scan', () => {
    // An empty scan would make the assertion below vacuous, which is the
    // failure mode this gate exists to prevent.
    const scanned = sourceFiles(path.join(repoRoot, 'packages'));
    expect(scanned.length).toBeGreaterThan(50);
  });

  it('declares no canonical event schema outside the contract package', () => {
    expect(offenders()).toEqual([]);
  });

  it('declares ReporterEventSchema in the contract, so the list is not vacuous', () => {
    const source = readFileSync(
      path.join(repoRoot, 'packages/shared-contracts/src/schemas/reporter-events.ts'),
      'utf8',
    );
    expect(source).toMatch(/export const ReporterEventSchema\s*=/);
  });
});
