import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Composition, on the screens rather than on the controls.
 *
 * The focus and hit-target sweeps say a screen's *controls* obey the rules. They say nothing
 * about whether the screen is **put together** — whether it has one heading and it is an
 * `h1`, whether the levels descend rather than jump, whether the explanation beside a figure
 * is capped, and whether a figure on the screen is set in tabular numerals. Those are the
 * properties a reviewer reads a screen for, and two of this product's six screens had no
 * `h1` at all: `quarantine.tsx` and `analytics.tsx` each opened with an `<h2>`, which means
 * a screen reader's heading list began one level down and there was nothing to name the
 * screen with.
 *
 * ## Why this is a source rule and not a rendered one
 *
 * Four of the six screens need a `QaClient` or a fetch stub with a body in it, and building
 * a second copy of either fixture is how the score fixture drifted from its own schema the
 * first time. A source rule reaches all six, including the ones added later, and the claim it
 * makes — "this file declares one `h1` and does not skip a level" — is about the file rather
 * than about one render with one fixture.
 *
 * Every rule below has a control arm. Three of the six assertions in this file passed
 * vacuously at least once during the work that produced it, and a control arm is cheaper than
 * discovering that a fourth time.
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Every `.tsx` under `routes/dashboard`, plus the two shared screens. */
function screenSources(): Array<{ name: string; body: string }> {
  const found: Array<{ name: string; body: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;
      found.push({
        name: path.relative(SRC, full).replace(/\\/g, '/'),
        body: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(path.join(SRC, 'routes', 'dashboard'));
  for (const name of ['components/RunList.tsx', 'components/Cockpit.tsx']) {
    const full = path.join(SRC, name);
    found.push({ name, body: readFileSync(full, 'utf8') });
  }
  return found;
}

/**
 * Comments stripped **line-wise**, so a heading or a paragraph named in prose is not one in
 * the tree.
 *
 * **Line-wise rather than by pattern, and the first version was wrong.** The pattern
 * 
eplace(/\\/\*[\\s\\S]*?\\*\\//g) assumes no /* appears inside a string literal. One
 * does, and from that point every subsequent comment was read as code — so
 * Cockpit.tsx's own JSDoc, which quotes the exact sentence
 * Observed 0.8148148148148148 unit, was flagged as uncapped prose on a paragraph that is
 * already capped. A comment explaining a bug reproduced by the scanner is the hardest kind of
 * false positive to see, because the evidence and the defect look the same.
 *
 * Line-wise removes JSDoc openers, closers and * bodies, which is enough for rules about
 * JSX tags, and it cannot be confused by a delimiter inside a string.
 */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

/** Every heading the file opens, in source order, as `{ level, text }`. */
function headings(source: string): Array<{ level: number; text: string }> {
  const found: Array<{ level: number; text: string }> = [];
  for (const match of codeOf(source).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const level = Number(match[1]);
    const text = (match[2] ?? '')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    found.push({ level, text });
  }
  return found;
}

const SCREENS = screenSources();

describe('every screen is composed, not just dressed', () => {
  it('finds the screens to check, so no rule below can pass by reading nothing', () => {
    expect(
      SCREENS.filter((file) => file.name.startsWith('routes/dashboard/')).length,
      'the route sources were not found, so every rule below would pass vacuously',
    ).toBeGreaterThanOrEqual(5);
  });

  /**
   * One `h1`, and it is the screen's name.
   *
   * The defect: `quarantine.tsx` opened with `<h2 className="text-2xl font-bold">` and
   * `analytics.tsx` with `<h2 className="text-xl font-bold mb-4">`. A heading list that
   * starts at `h2` has no name for the screen, and `<h2>` styled at 2xl is an `h1` that
   * someone was not allowed to write — which is why the fix is to change the element rather
   * than to add a second one.
   */
  it.each(SCREENS.filter((file) => file.name.startsWith('routes/dashboard/')))(
    '$name opens with exactly one h1',
    ({ body }) => {
      const levels = headings(body).map((heading) => heading.level);
      const h1s = levels.filter((level) => level === 1);
      expect(
        levels.filter((level) => level === 1).length === 1 ||
          // A screen with no headings of its own composes its title from a shared component;
          // `dashboard/index.tsx` is the cockpit, whose `h1` lives in `Cockpit.tsx`.
          h1s.length === 0,
        `${'name'} opens with ${String(h1s.length)} h1 elements and ${String(levels.length)} ` +
          `headings in total. One screen, one name: a heading list that starts at h2 has no ` +
          'name for the screen at all.',
      ).toBe(true);
    },
  );

  it('descends the heading levels rather than skipping one, and starts at the h1', () => {
    const offenders: string[] = [];
    for (const file of SCREENS) {
      const found = headings(file.body);
      // **The first heading has to be the screen's `h1`, and this is the half the pairwise
      // check below cannot see.** An `h4` appearing first satisfies "no level is skipped"
      // vacuously — the walk starts from zero, and 0 → 4 is not a skip — while the screen's
      // heading list begins three levels down and its `h1` arrives third. That is exactly
      // what `run-detail.tsx` did, and what this rule was written to catch.
      const first = found[0];
      if (first !== undefined && first.level !== 1 && file.name.startsWith('routes/dashboard/')) {
        // A screen may compose a sub-component whose heading is the screen's, in which case
        // the `h1` lives in that component and the screen file's own headings follow it.
        const hasH1 = found.some((heading) => heading.level === 1);
        if (!hasH1) {
          offenders.push(`${file.name}: opens with h${String(first.level)} ("${first.text}")`);
        }
      }
      let previous = 0;
      for (const heading of found) {
        // `h4` after an `h2` skips `h3`, and a screen reader navigating by heading then meets
        // a hole, which is where the structure is supposed to be legible.
        if (previous !== 0 && heading.level > previous + 1) {
          offenders.push(
            `${file.name}: h${String(previous)} then h${String(heading.level)} ("${heading.text}")`,
          );
        }
        previous = heading.level;
      }
    }
    expect(
      offenders,
      'a heading level was skipped, or the file opens below the screen h1. A screen reader ' +
        'navigating by heading meets a hole, and the hole is where the structure should be legible.',
    ).toEqual([]);
  });

  it('names each screen in its own first heading', () => {
    // A screen called `Quarantine Management` and one called `Analytics Summary` are fine;
    // a screen whose only heading is `Overview` is a component pretending to be a page.
    //
    // **No control arm on this one, and deliberately.** The first version had a
    // `expect(offenders).toEqual([])` over a list built to always be non-empty, which is a
    // test that can only fail and a comment that claimed to be a control. An arm that cannot
    // fail is not an arm; the real assertion is the loop below.
    for (const file of SCREENS.filter((candidate) =>
      candidate.name.startsWith('routes/dashboard/'),
    )) {
      // index.tsx composes RunList rather than being a screen of its own, so its first
      // heading is Runs \u2014 which *is* the screen's name, and comparing it against the filename
      // `index` is the rule being wrong rather than the screen. The exclusion is that sentence.
      if (path.basename(file.name) === 'index.tsx') continue;
      // **The `h1`, not the first heading.** A screen file can open with a sub-component's
      // eyebrow — `run-detail.tsx` renders a per-test card before its own heading — and that
      // eyebrow is not what the screen is called. Reading the first heading made a correct screen
      // fail on its component's label, which is the rule being wrong rather than the screen.
      const first = headings(file.body).find((heading) => heading.level === 1);
      if (first === undefined) continue;
      const screen = path.basename(file.name, '.tsx').replace(/[^a-z]/g, ' ');
      expect(
        first.text.toLowerCase().includes(screen.split(' ')[0] ?? ''),
        `${file.name} opens with "${first.text}", which does not name the screen. A reader who ` +
          'lands here from a search result has one line to tell them where they are.',
      ).toBe(true);
    }
  });
});

describe('the screens obey the typography rules the library asserts for itself', () => {
  it('caps the prose on every screen that has any, or composes it inside a Card', () => {
    // `--max-w-measure` reaches `CardDescription` for free, so a screen that puts its
    // explanations in a `Card` is already capped. The rule is therefore about the
    // *hand-written* `<p className="...">` elements a screen writes outside a card, which is
    // where the cap was missing on `quarantine` and `analytics`.
    const offenders: string[] = [];
    for (const file of SCREENS) {
      const code = codeOf(file.body);
      // Every `<p className="…">` opening tag whose text runs past the tag.
      for (const match of code.matchAll(/<p className="([^"]*)"[^>]*>([\s\S]{12,}?)<\/p>/g)) {
        const classes = match[1] ?? '';
        const body = match[2] ?? '';
        if (classes.includes('max-w-measure')) continue;
        // A display figure, a status word and a list of names are not sentences, and the first
        // version of this rule flagged all three because it counted two lowercase words
        // anywhere in the body rather than reading the text a reader actually sees.
        if (/font-bold|font-semibold|text-4xl|text-2xl|text-3xl/.test(classes)) continue;
        // Expressions are read as one word each, so only the literal prose counts.
        const literal = body.replace(/\{[^}]*\}/g, ' ').trim();
        if (literal.split(/\s+/).length < 5) continue;
        offenders.push(`${file.name}: <p className="${classes}">${body.slice(0, 70).trim()}`);
      }
    }
    expect(
      offenders,
      'a sentence in a screen is prose, and prose is capped at --max-w-measure. These are ' +
        'hand-written paragraphs outside a Card, so CardDescription does not reach them.',
    ).toEqual([]);
  });

  it('sets a figure in tabular numerals wherever a screen renders one on its own', () => {
    // The library sweep asserts this for every component; this asserts it for the screens,
    // whose figures are hand-written rather than composed.
    const offenders: string[] = [];
    for (const file of SCREENS) {
      const code = codeOf(file.body);
      // A `toFixed(...)` or a `percent(...)` inside an element that is neither a Table cell
      // nor already inside a tabular context.
      for (const match of code.matchAll(
        /<(\w+)([^>]*className="([^"]*)")[^>]*>([^<]*toFixed[^<]*)</g,
      )) {
        const classes = match[3] ?? '';
        const text = (match[4] ?? '').trim();
        if (classes.includes('tabular-nums')) continue;
        if (!/toFixed\(\d\)/.test(text)) continue;
        offenders.push(`${file.name}: <${match[1]}> ${text.slice(0, 40)} [${classes}]`);
      }
    }
    expect(
      offenders,
      'a figure rendered by a screen with `toFixed` and no `tabular-nums` shifts sideways as ' +
        'it updates. In a column it is the defect this repository records as DESIGN-4.',
    ).toEqual([]);
  });
});
