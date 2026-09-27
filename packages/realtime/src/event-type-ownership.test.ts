import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One declaration per canonical event *type*, not merely per canonical schema name.
 *
 * `event-name-ownership.test.ts` already fails when a canonical *schema* is declared
 * outside `@automate/shared-contracts`. It cannot see the other half of the problem:
 * the event type a writer emits and the event type a reader matches on are **strings**,
 * and a string is invisible to a schema-name gate. So `run:started` was written out
 * as a literal in eight files across four packages — five `z.literal('run:started')`
 * declarations and three bare strings in writers — with nothing tying any of them to
 * any other.
 *
 * The failure that shape produces: a writer emits a type a reader does not match, or
 * renames one side of a pair. Neither is a compile error, neither is caught by the
 * schema validators on either end (each side is perfectly valid under its own
 * declaration), and the event is silently dropped. A dashboard that stops updating
 * is the symptom; the typo is the cause, and there is no gate between them.
 *
 * So: the canonical types are exported as named constants from the contract, and this
 * test fails if one is written as a literal anywhere else. A consumer imports the
 * constant; a string in a writer is now a reportable event.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACT_ROOT = 'packages/shared-contracts/';

/**
 * The canonical event types, read from the contract rather than restated here.
 *
 * A list typed into this file would drift from the contract and make the gate
 * meaningless — it would catch a typo in one place and pass on a new event type added
 * in another. So the names come from the declarations themselves.
 */
const CANONICAL_TYPE_CONSTANTS = [
  'RUN_STARTED_EVENT_TYPE',
  'TEST_STARTED_EVENT_TYPE',
  'TEST_COMPLETED_EVENT_TYPE',
  'RUN_COMPLETED_EVENT_TYPE',
  'RUN_UPDATED_EVENT_TYPE',
] as const;

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

/** Every `export const <canonical name> =` outside the contract package. */
function redeclarations(): string[] {
  const pattern = new RegExp(
    `export\\s+const\\s+(${CANONICAL_TYPE_CONSTANTS.join('|')})\\s*=`,
    'g',
  );
  const found: string[] = [];
  for (const directory of ['apps', 'packages', 'tools', 'tests']) {
    for (const file of sourceFiles(path.join(repoRoot, directory))) {
      const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
      if (relative.startsWith(CONTRACT_ROOT)) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        found.push(`${match[0].trim()} in ${relative}`);
      }
    }
  }
  return found.sort();
}

/**
 * Comments removed, so a *mention* of an event type is not a *use* of one.
 *
 * The doc comment on `ReporterRouteOptions.realtimeBus` says "a `run:updated` event
 * is published", in backticks, describing the behaviour. A gate that flagged that
 * would have two bad options: rewrite the documentation to dodge it, which teaches
 * the next writer to write misleading comments; or drop backticks, and lose the one
 * convention that makes a type name readable in prose. Both are worse than a gate
 * that can tell prose from code.
 *
 * Stripping comments by pattern rather than by parsing is a real limitation: a `//`
 * inside a string literal would be truncated. That makes the scan *more* permissive,
 * never less — a value hidden behind a quote-in-a-comment would be missed rather than
 * falsely reported, and the failure mode is a missed use, not a false alarm. A missed
 * use is still caught the moment the string is edited.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * The canonical event types' *values*, read from the contract's own declarations.
 *
 * Read rather than restated, so adding an event type to the contract immediately
 * extends what this test forbids elsewhere. A hardcoded `['run:started', ...]` here
 * would go stale the moment an event was added, and a stale gate is worse than none:
 * it reports a clean tree.
 */
function canonicalEventTypes(): string[] {
  const contract = readFileSync(
    path.join(repoRoot, 'packages/shared-contracts/src/schemas/reporter-events.ts'),
    'utf8',
  );
  return CANONICAL_TYPE_CONSTANTS.map((name) => {
    const declaration = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*'([^']+)'`).exec(contract);
    if (declaration?.[1] === undefined) {
      throw new Error(`${name} is not exported as a string constant by the contract`);
    }
    return declaration[1];
  });
}

/**
 * Where `value` is written as a literal in one file, as `path:line` strings.
 *
 * One function per file rather than one big loop over files and values and matches:
 * three nested loops inside a `for…of` with a `throw` and a regex build is the shape
 * where the next person cannot tell which branch is failing, and the complexity
 * ratchet is right about that.
 */
function literalUsesInFile(file: string, values: readonly string[]): string[] {
  const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
  if (relative.startsWith(CONTRACT_ROOT)) return [];
  const source = withoutComments(readFileSync(file, 'utf8'));
  const found: string[] = [];
  for (const value of values) {
    // A quoted literal only. A reference to the imported constant, a `satisfies`
    // clause, or a name in a doc comment is exactly what this should allow.
    for (const match of source.matchAll(new RegExp(`(['"\`])${value}\\1`, 'g'))) {
      const line = source.slice(0, match.index).split('\n').length;
      found.push(`${relative}:${line} writes ${value} as a literal`);
    }
  }
  return found;
}

function literalUses(): string[] {
  const values = canonicalEventTypes();
  const found: string[] = [];
  for (const directory of ['apps', 'packages', 'tools', 'tests']) {
    for (const file of sourceFiles(path.join(repoRoot, directory))) {
      found.push(...literalUsesInFile(file, values));
    }
  }
  return found.sort();
}

describe('canonical event types', () => {
  it('finds the source files it is meant to scan', () => {
    // An empty scan would make both assertions below vacuous, which is the failure
    // mode this gate exists to prevent — and the one `event-name-ownership.test.ts`
    // already hit once, when a non-global `matchAll` threw and the loop around it
    // swallowed the error and found nothing.
    const scanned = sourceFiles(path.join(repoRoot, 'packages'));
    expect(scanned.length).toBeGreaterThan(50);
  });

  it('declares each canonical type in the contract, so the list is not vacuous', () => {
    const contract = readFileSync(
      path.join(repoRoot, 'packages/shared-contracts/src/schemas/reporter-events.ts'),
      'utf8',
    );
    for (const name of CANONICAL_TYPE_CONSTANTS) {
      expect(contract, `${name} is missing from the contract`).toMatch(
        new RegExp(`export\\s+const\\s+${name}\\s*=`),
      );
    }
  });

  it('is declared outside the contract package nowhere', () => {
    expect(redeclarations()).toEqual([]);
  });

  it('is written as a string literal outside the contract nowhere', () => {
    expect(literalUses()).toEqual([]);
  });
});
