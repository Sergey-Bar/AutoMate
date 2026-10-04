import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const motionCss = readFileSync(path.join(here, 'motion.css'), 'utf8');
const themeCss = readFileSync(path.join(here, 'theme.css'), 'utf8');

/** The comments of the stylesheet, with their bodies, in order. */
function commentsOf(css: string): string[] {
  return [...css.matchAll(/\/\*([\s\S]*?)\*\//g)].map((match) => match[1] ?? '');
}

/** Every shipped component module, as `{ name, body }`, excluding tests and stories. */
function componentSources(): Array<{ name: string; body: string }> {
  const root = path.join(here, '../components');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(path.join(root, entry.name))
        .filter(
          (file) =>
            file.endsWith('.tsx') && !file.includes('.test.') && !file.includes('.stories.'),
        )
        .map((file) => ({
          name: `${entry.name}/${file}`,
          body: readFileSync(path.join(root, entry.name, file), 'utf8'),
        })),
    );
}

/** Block comments stripped, so a class named in prose is not a class in the tree. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('motion is a stated vocabulary rather than a scattering of utilities', () => {
  /**
   * Four keyframes is a vocabulary only if each one is *for* something.
   *
   * `motion.css` declared `automate-enter`, `automate-exit`, `automate-zoom-in` and
   * `automate-zoom-out` and named what they do â€” opacity in, opacity out â€” which is two
   * effects in four costumes. A keyframe with no stated purpose is a fourth thing a
   * component may reach for, and the answer to "what should this animate" becomes "whatever
   * compiles".
   *
   * The assertion is that **every** `@keyframes` block in the stylesheet is described in a
   * comment, so adding one without saying what it is for fails here rather than
   * accumulating.
   */
  it('names what every keyframe is for', () => {
    const declared = [...motionCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
    expect(declared.length, 'motion.css declares no keyframes').toBeGreaterThan(0);
    const prose = commentsOf(motionCss).join('\n');
    const undescribed = declared.filter((name) => !prose.includes(name));
    expect(
      undescribed,
      'every @keyframes in motion.css has to say what it is for. A keyframe with no stated ' +
        'purpose is one more thing a component may reach for, and the answer to "what should ' +
        'this animate" becomes "whatever compiles".',
    ).toEqual([]);
  });

  it('publishes every duration, the easings and the press scale as variables', () => {
    // The press scale is the reason this list exists. `Button` hardcoded
    // `active:scale-[0.98]` â€” a number typed into a class string, which no media query can
    // reach, so `prefers-reduced-motion` could not stop the press feedback. One number in
    // this file, multiplied by the same scale the durations are multiplied by.
    for (const variable of [
      '--automate-press-scale',
      '--automate-motion-scale',
      '--automate-duration-75',
      '--automate-duration-100',
      '--automate-duration-150',
      '--automate-duration-200',
      '--automate-duration-300',
      '--automate-ease-out',
      '--automate-ease-in',
      '--automate-ease-in-out',
    ]) {
      expect(motionCss, `motion.css does not declare ${variable}`).toMatch(
        new RegExp(`${variable.replace(/-/g, '\\-')}\\s*:`),
      );
    }
  });

  it('uses the press scale token in the product rather than an arbitrary value', () => {
    const offenders = componentSources()
      .filter((source) => /active:scale-\[/.test(codeOf(source.body)))
      .map((source) => source.name);
    expect(
      offenders,
      '`active:scale-[0.98]` is a number typed into a class string. It is one value that no ' +
        'media query can reach, so `prefers-reduced-motion` cannot stop the press feedback. ' +
        '`motion.css` declares `--automate-press-scale`; a component should not.',
    ).toEqual([]);
  });

  it('transitions only the properties that move', () => {
    // `transition-all` was in `Button` and `Toast`. It transitions every property the
    // element has, including the ones a component change will introduce later, which is
    // how a colour starts animating on hover by accident and nobody decides it. The two
    // properties that actually move on a control are its background and its border; on a
    // toast that is being told to leave, it is opacity and transform.
    const offenders = componentSources()
      .filter((source) => /transition-all/.test(codeOf(source.body)))
      .map((source) => source.name);
    expect(
      offenders,
      '`transition-all` transitions every property the element has, now and after the next ' +
        'component change. Name the properties that move.',
    ).toEqual([]);
  });

  it('animates only compositor properties, so the cost does not scale with the tree', () => {
    // `opacity`, `transform` and `filter` are the three a compositor can handle without
    // laying out or repainting. `height`, `width`, `top`, `left`, `margin` and `padding` are
    // the four that force a layout pass on every frame, and `glassStackDepth` in
    // `performance/rendering-budget.json` is the ceiling that already exists for the other
    // half of this cost.
    const PROPERTIES = ['height', 'width', 'top', 'left', 'right', 'bottom', 'margin', 'padding'];
    const offenders = componentSources().flatMap((source) => {
      const code = codeOf(source.body);
      return PROPERTIES.flatMap((property) => {
        const transition = new RegExp(`transition-(?:property|all)[^"'\`]*\\b${property}\\b`);
        const animate = new RegExp(`animate-[^"'\`]*\\b${property}\\b`);
        return transition.test(code) || animate.test(code) ? [`${source.name}: ${property}`] : [];
      });
    });
    expect(
      offenders,
      'an animated height, width, offset or box metric forces a layout pass on every frame. ' +
        'Animate opacity, transform or filter, and if the box genuinely has to change, measure ' +
        'it rather than assuming.',
    ).toEqual([]);
  });

  it('keeps the reduced-motion escape hatch in one place and one place only', () => {
    // `motion.css` is the authority: one multiplier plus one global `0.01ms` nuke for the
    // literal `duration-*` utilities a component writes. A second copy anywhere else would
    // be a second policy for the same user request, which is what `theme.test.ts` already
    // asserts about `prefers-reduced-motion` in `theme.css`.
    expect(themeCss, 'theme.css has grown its own reduced-motion rule').not.toContain(
      'prefers-reduced-motion',
    );
    expect(commentsOf(motionCss).join('\n')).toContain('prefers-reduced-motion');
  });

  it('states, for each of the four overlay surfaces, what it does when it opens', () => {
    // The plan's W4 point 4: `Dialog`, `Drawer`, `Popover`, `Tooltip`, `CommandPalette` and
    // `EmptyState` all wrote `animate-*`, and all of them resolved â€” but "it animates" is
    // not a direction. A drawer slides; a dialog rises; a popover scales from its anchor; a
    // toast enters and leaves. Stating it is what stops the next overlay copying whatever
    // its neighbour happened to use.
    const sources = componentSources();
    const expectations: ReadonlyArray<readonly [file: string, mustMention: string]> = [
      ['Drawer/Drawer.tsx', 'slide'],
      ['Dialog/Dialog.tsx', 'rise'],
      ['Popover/Popover.tsx', 'scale'],
      ['Toast/Toast.tsx', 'enter'],
    ];
    for (const [file, mustMention] of expectations) {
      const source = sources.find((candidate) => candidate.name === file);
      expect(source, `no component source named ${file}`).toBeDefined();
      const prose = commentsOf(source?.body ?? '')
        .join('\n')
        .toLowerCase();
      expect(
        prose.includes(mustMention),
        `${file} does not say what it does when it opens. An overlay that "animates" has no ` +
          `direction, and the next one copies whatever its neighbour used. Say it: ${mustMention}.`,
      ).toBe(true);
    }
  });
});
