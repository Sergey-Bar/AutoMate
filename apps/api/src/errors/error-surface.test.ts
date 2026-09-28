import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The gate C-3 asks for, so the migration cannot quietly become partial again.
 *
 * Finding C-3 was not "42 call sites look repetitive". It was that the API had **two**
 * ways of refusing a request — a local `error(c, …)` helper that built the response body
 * by hand, and `c.json({ error: 'prose' })` at the call site — and neither was checked
 * against the taxonomy, so a code nobody had heard of compiled and a status that
 * contradicted its code compiled too.
 *
 * **A migrated count is not a fix.** The count went to zero once and this row stayed open
 * for a year, because nothing failed when it came back. So this asserts the *shape* of
 * the source rather than a tally.
 *
 * It reads source rather than behaviour because the behaviour is identical: both paths
 * produce a JSON body, and only one of them produces a body with a `code` in it. A
 * behavioural gate would have to call every route in every failure mode; this one reads
 * every line.
 */

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every `.ts` under `src/`, excluding tests. */
function productFiles(dir = srcRoot, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      productFiles(full, found);
      continue;
    }
    if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Blank out comments, preserving every offset.
 *
 * Same length in, spaces out, so a pattern matched in the masked copy is at the same
 * index in the original and can be reported with a real line number. The first version
 * of this test stripped comments into a shorter string and then matched against the
 * original, which made the line numbers it printed invented — and the files it flagged
 * were its own doc comment describing the shape it forbids.
 *
 * String *contents* are deliberately left alone, because the thing being reported is
 * which prose a body carries. Blanking them would turn every match into an empty string
 * and the failure would say nothing about what to fix.
 *
 * Three passes rather than one: a single loop carrying all three cases is one function
 * with five branches, and the complexity ceiling exists to stop exactly that. The passes
 * are idempotent and the order does not matter, because each one only blanks its own
 * construct and never re-scans a blanked region.
 */
function withoutComments(text: string): string {
  return blankBlock(text).split('\n').map(blankLine).join('\n');
}

/** `@returns `text` with every `/* … *\/` region replaced by spaces. */
function blankBlock(text: string): string {
  const out = text.split('');
  let at = 0;
  for (;;) {
    const open = text.indexOf('/*', at);
    if (open < 0) break;
    const close = text.indexOf('*/', open + 2);
    const stop = close < 0 ? text.length : close + 2;
    blank(out, open, stop);
    at = stop;
  }
  return out.join('');
}

/** `@returns `line` with a `//` comment replaced by spaces, strings left alone. */
function blankLine(line: string): string {
  const open = line.indexOf('//');
  if (open < 0) return line;
  // A `//` inside a string is not a comment, so the line is quoted or it is not.
  const before = line.slice(0, open);
  const quotes = (before.match(/['"`]/g) ?? []).length;
  if (quotes % 2 === 1) return line;
  return line.slice(0, open).padEnd(line.length, ' ');
}

/** Blanks `[from, to)` in place, keeping the newlines so line numbers survive. */
function blank(out: string[], from: number, to: number): void {
  for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
}

const files = productFiles();

/** `@param file @returns every `error: '…'` in it, with a real line number. */
function proseErrorBodies(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const masked = withoutComments(source);
  const found: string[] = [];
  // Both quote styles. A first version matched only `'…'`, and the three bodies whose
  // message was a template literal — a quarantine transition, a terminal run status, an
  // invalid status — sailed straight through it. The message is a runtime string in
  // both cases and the shape is the same defect either way.
  for (const match of masked.matchAll(/\berror:\s*(?:'([^']*)'|`([^`]*)`)/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    const message = match[1] ?? match[2] ?? '';
    found.push(`${path.relative(srcRoot, file)}:${String(line)} — ${message}`);
  }
  return found;
}

describe('the error surface is one taxonomy and one renderer', () => {
  it('finds files to check, so none of these can pass by reading nothing', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no `error(c, …)` helper left, in any product file', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (/\berror\(\s*c\s*,/.test(withoutComments(readFileSync(file, 'utf8')))) {
        offenders.push(path.relative(srcRoot, file));
      }
    }
    expect(
      offenders,
      'these files still build an error response by hand. Every refusal is a ' +
        '`throw new DomainError(code, message)` and the boundary renders it.',
    ).toEqual([]);
  });

  it('has no error body that is a bare string', () => {
    const offenders = files.flatMap(proseErrorBodies);
    expect(
      offenders,
      'an error body that is prose cannot be branched on. Use a `DomainError`, or ' +
        '`domainErrorResponse` where a hook must return rather than throw.',
    ).toEqual([]);
  });

  it('registers no second error boundary', () => {
    // `AGENTS.md`: one error boundary, in `errors/boundary.ts`. `routes/runner.ts` had
    // its own, which is how a runner client ended up matching on the string
    // "Unauthorized" with no code to branch on.
    //
    // `test-support/` is excluded because it *calls* `createErrorBoundary` — it is the
    // harness that mounts the real one — and `index.ts` because it is where the real one
    // is installed. Neither defines a boundary; both would be a second one if they did.
    const allowed = new Set(['index.ts']);
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(srcRoot, file);
      if (relative.startsWith('test-support') || allowed.has(relative)) continue;
      if (/\.onError\(/.test(withoutComments(readFileSync(file, 'utf8')))) {
        offenders.push(relative);
      }
    }
    expect(offenders, 'a second boundary is a second answer to the same question').toEqual([]);
  });

  it('is a gate that can fail, and says so', () => {
    // A source-reading gate that silently matched nothing would pass forever, which is
    // how this row was open for a year after its count reached zero. So one of the three
    // checks above is run against a source that *does* contain the defect, here.
    const withDefect = `
      import { Hono } from 'hono';
      // A doc comment describing { error: 'Unauthorized' } must not count.
      export function bad(c: Hono) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    `;
    // Line 5, not line 3: the comment on line 3 describes the same shape and is skipped,
    // which is the property the masker exists for. Getting the number right is also the
    // check that the line arithmetic is right — a gate that reported invented line
    // numbers would be a gate nobody could act on.
    expect(proseErrorBodiesIn(withDefect, 'hypothetical.ts')).toEqual([
      'hypothetical.ts:5 — Unauthorized',
    ]);
    // And the template form, which the first version of this check did not match and
    // which three real bodies used.
    expect(
      proseErrorBodiesIn('return c.json({ error: `a ${x} b` }, 409);', 'hypothetical.ts'),
    ).toEqual(['hypothetical.ts:1 — a ${x} b']);
    expect(/\berror\(\s*c\s*,/.test(withoutComments("error(c, 400, 'X', 'y')"))).toBe(true);
  });
});

/** The same scan, over a source string rather than a file. */
function proseErrorBodiesIn(source: string, name: string): string[] {
  const masked = withoutComments(source);
  const found: string[] = [];
  for (const match of masked.matchAll(/\berror:\s*(?:'([^']*)'|`([^`]*)`)/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    found.push(`${name}:${String(line)} — ${match[1] ?? match[2] ?? ''}`);
  }
  return found;
}
