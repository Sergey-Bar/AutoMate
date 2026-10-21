---
title: The design language
description: A flat, monochrome plane where colour only ever means a verdict — the four steps, the accent, and the numbers every colour has to clear.
---

# The design language

This page is the written half of a decision that is also machine-checked. Every colour,
type face, duration and motion utility described here is declared in
`packages/ui/src/tokens/` and asserted by `theme.test.ts`, `fonts.test.ts` and
`motion.test.ts`; `apps/web/src/theme-resolution.test.ts` proves that every utility any
component writes actually generates. Where this page says a token owes 4.5:1, there is
an assertion per theme, per plane step, that fails if it stops.

::: tip Changing something here
Change the token and run the tests. A literal colour in a component is a build
failure, and a colour in this page that is not in `theme.css` is a page that has
drifted from the product.
:::

## The principle

**Monochrome, flat, and colour is meaning.** The product is an instrument: a QA engineer
opens it to learn what is wrong and what is good, and every pixel that is coloured is a
pixel they have to decide about. So the plane is neutral grey in four opaque steps, the
accent is the foreground tone rather than a brand hue, and the only colour on screen is a
verdict — pass, warn, fail, flaky — or a chart series. There is no glass and no gradient.

## The plane

Four steps, and the names do not change between themes — the plane is what inverts.

| Token                       | Dark      | Light     | What it is for                                                    |
| --------------------------- | --------- | --------- | ----------------------------------------------------------------- |
| `--automate-surface-sunken` | `#050505` | `#ebebed` | The page behind the panels, and the evidence surfaces inside them |
| `--automate-surface`        | `#0a0a0a` | `#ffffff` | A panel. The base                                                 |
| `--automate-surface-raised` | `#121212` | `#fcfcfc` | A control sitting on the base, and every overlay                  |
| `--automate-surface-muted`  | `#171717` | `#f4f4f5` | The recessed fill inside a control                                |

In dark mode the plane gets **lighter** as it rises; in light mode it gets **closer to
white**. That inversion is asserted, not described: `theme.test.ts` checks that
`surface-sunken` is the darkest step in both themes, that `surface-raised` lies
strictly between the base and the inset, and that the direction from base to inset is
opposite in the two themes. It also holds every plane step, both foregrounds and the
decorative border under 0.012 OKLCH chroma — the plane is grey, not cool or warm.

There is no fifth surface. A component that needs one is a component that needs a
token, a contrast case and a name for what the new step is.

### Elevation

Depth comes from the plane step and a hairline. A shadow is for something that floats:

| Step | Shadow                                    | For                                     |
| ---- | ----------------------------------------- | --------------------------------------- |
| `1`  | `0 1px 2px rgb(0 0 0 / 0.32)`             | Rarely; a card does not need one        |
| `2`  | `0 4px 12px -2px`, plus a 1px `0 1px 3px` | A popover, a toast                      |
| `3`  | `0 18px 48px -12px`, plus `0 4px 12px`    | A dialog, a drawer, the command palette |

Cards and panels carry **no** shadow: one opaque step and the decorative border.

### The light plane

White panels on a soft neutral page (`#ebebed`), at least 1.15:1 apart — asserted in
`theme.test.ts` — with a decorative edge of `#dcdcdf` that is visible on white and still
under the 3:1 that would outline every box. The three elevation steps are re-declared
for light only, as low-alpha neutral shadows: on white a 32% black shadow is a smudge.

### The chart palette

Charts have their own roles — `chart-pass`, `chart-fail`, `chart-flaky`, `chart-skipped`,
`chart-line`, `chart-grid` and a six-step series `chart-1…6` — derived from Okabe and
Ito's colour-universal palette and tuned per theme. They replaced the status colours at
three opacities, which is what made "passed" and "other" one blur. `theme.test.ts` holds
three claims about them: every mark is at least 3:1 on every plane step (WCAG 1.4.11),
every pair of run states is at least 0.12 OKLab ΔE apart normally and 0.06 under a
deuteranopia simulation, and the gridline stays a guide (between 1.05:1 and 3:1).

### Every dialog has three ways out

A close button in the header, a click on the backdrop, and Escape. Escape alone was the
toolbox's defect (`UX-DIALOG-1`): a phone has no Escape key. Focus opens on the title, not
the first button, so no action is armed before the dialog has been read; a form marks its
first field `data-autofocus` instead.

## The accent

`--automate-accent` is `#e5e5e5` in dark and `#171717` in light — the foreground tone, with
no hue. `theme.test.ts` holds it under 0.01 OKLCH chroma in both themes.

It is allowed in three places:

- the focus ring,
- the active state (the current section in the navigation, a selected tab),
- the one solid primary fill — a white button with a black label in dark, black with a
  white label in light.

It is never a verdict, and now it cannot look like one: a reader who has learned that
green means passed is never asked whether a blue pixel is a result or the brand.

## Run state, and why `info` is quieter

| Token                | Dark      | Light     | OKLCH hue         |
| -------------------- | --------- | --------- | ----------------- |
| `--automate-success` | `#66bb74` | `#206c32` | 148               |
| `--automate-warning` | `#e4a247` | `#7e5415` | 72                |
| `--automate-danger`  | `#d9716b` | `#9f3331` | 25                |
| `--automate-info`    | `#7c8da6` | `#4d5f79` | 258, chroma 0.048 |

`--automate-info` is steel: a note, never a verdict. The test asserts it categorically —
every run state is at least half as saturated again as info — rather than picking a
number, because the claim is about being visibly quieter.

The three run states keep 20 degrees or more of hue between them, which is about where
two hues stop being separable by hue alone. Below that the palette is relying on
saturation as well as hue, which is exactly what a reader with a colour vision
deficiency cannot do. `theme.test.ts` measures the hues in OKLab and asserts the
decisions, because a contrast ratio cannot check a hue.

**A status is never colour alone.** A verdict is a dot _and_ a word, and a trend is an
icon _and_ a screen-reader label (`StatusDot`, `StatCard`).

**These are used as body text.** `Alert` and `Toast` render `text-success` over
`bg-success/10`, so they owe 4.5:1 — not the 3:1 a swatch would owe — and a second
4.5:1 against their own 10% tint. The tint raises the background luminance and _lowers_
the contrast, so a ratio computed against the untinted surface would pass while the
shipped rendering failed. There is a test for that case per plane step.

## Two borders, because 1.4.11 is not about every border

| Token                      | Dark      | Light     | Measured                                      |
| -------------------------- | --------- | --------- | --------------------------------------------- |
| `--automate-border`        | `#262626` | `#dcdcdf` | ~1.3:1 on the base — below 3:1 **on purpose** |
| `--automate-border-strong` | `#6b6b6b` | `#76767c` | 3.2:1 or better against every plane step      |

`--automate-border` is decoration: a card outline, a divider, a table rule. A card edge
at 3:1 on a plane this dark is a mid-grey line around every rectangle on the screen.

`--automate-border-strong` is the edge that is the _only_ thing delineating a control,
which is the case WCAG 1.4.11 does cover. `Input`, `Select`, `Textarea` and `Toggle` use
it. Before it existed they drew their 1px edge from the decorative token and measured
1.31:1, so a low-vision keyboard user had no way to see where the field ended.

The test asserts the strong border against all four plane steps, not only the base,
because a control painted on `--automate-surface-sunken` has to survive there too — and
in the dark theme the _muted_ step is the binding constraint, not the base.

## Type

Two families, and the rule is which of them a string is.

- **Archivo** for everything that is read. A grotesque with a real width axis
  (`wght` 100–900, `wdth` 62–125), one variable file, latin subset.
- **JetBrains Mono** for everything that is a reading: run ids, digests, stack traces,
  JUnit output, and every column of numbers. `font-variant-numeric: tabular-nums` on
  those, because comparing two values character by character is the one job a
  proportional face cannot do.

Self-hosted from `packages/ui/src/assets/fonts/`, latin subset, woff2 only, one file per
family rather than per weight. `fonts-lock.json` records the upstream URL and a sha256
for each; `fonts.test.ts` checks both directions — the recorded digest, and that no
binary has been added without a row.

### The fallback faces

`Archivo Fallback` and `JetBrains Mono Fallback` are local faces carrying metrics
overrides, and that is the whole reason the swap does not move a line. Without them a
reader on a cold cache gets the local face's line box for the length of the download and
every block below it shifts.

The percentages are **measured, not conventional** — read out of each face's `hhea`
table at `unitsPerEm` 1000, and the lock records where:

|               | Archivo          | JetBrains Mono      |
| ------------- | ---------------- | ------------------- |
| ascent        | 87.8%            | 102%                |
| descent       | 21%              | 30%                 |
| line gap      | 0%               | 0%                  |
| x-height      | 52.6%            | 55%                 |
| fallback face | `local('Arial')` | `local('Consolas')` |
| `size-adjust` | 101.43%          | 103.97%             |

`ascent-override` and `descent-override` are percentages of the em, so they hold
whichever local face is actually selected and they are what fixes the line box.
`size-adjust` compares x-heights and is therefore specific to the face it was measured
against; a third platform's fallback gets the right line box and a slightly wrong glyph
size, which is the acceptable half of the problem. `line-gap-override: 0%` is stated on
both because Arial's own line gap is 67/2048, and leaving it in is three extra pixels
per line for the length of the swap.

A test cannot read a woff2, so the link between the lock and the stylesheet is what is
asserted — and the provenance is recorded beside it for a reviewer to check. A test that
claimed to have measured a font would be claiming more than it does.

## Motion

Four `@keyframes` and four `--animate-*` entries, declared in
`packages/ui/src/tokens/motion.css`. The reason they are tokens rather than a plugin:
sixteen class names across six components — `animate-in`, `fade-in`, `fade-in-0`,
`fade-in-90`, `zoom-in-95` and their `open:`-prefixed forms — were written against
`tailwindcss-animate`, which is not a dependency here. There are no `@keyframes` for
them anywhere, so every one compiled to nothing and the dialog, the drawer, the palette,
the popover, the tooltip and the empty state all appeared instantly — with their class
strings intact, which is why every test asserting on the class name passed.

A plugin would be one more dependency whose behaviour is versioned separately from this
tree, for four keyframes.

Every duration is `calc(<value> * var(--automate-motion-scale))`, so
`prefers-reduced-motion` has exactly one declaration to change. The components also write
Tailwind's own `duration-*`, which compile to literal times and cannot be reached by a
scale variable — so the media query clamps the properties themselves as well, or the
drawer still slides. `0.01ms` rather than `0s`: a zero duration can suppress the
`animationend` event a component is waiting on.

## No glass

`backdrop-filter` is an **error** in every `.ts` and `.tsx` file, with no allowlist
(`eslint.config.js`, proved live by `scripts/lib/eslint-plugin-compatibility.test.mjs`).
`theme.css` declares no glass token and no page wash, `theme-resolution.test.ts` fails on
any `backdrop-*` class, and `tests/performance/rendering-budget.json` holds the glass stack
depth at **0** on every primary route, measured from computed style in a real browser.

Glass shipped for a while against a measured contrast rule. It was removed because a
lens makes the readability of the thing being read depend on whatever is underneath,
and in an evidence console the pixels behind a panel are usually the evidence. An
overlay is the raised plane step at `shadow-elevation-3`; a scrim darkens and is never
read through.

## The Overview and the Map

**Four sections, and every old page is a tab.** Overview, Runs, Insights and Map are the
only top-level destinations (`apps/web/src/route-manifest.ts`, `SECTIONS`); the eight pages
that used to be in the bar are tabs of those sections, at the URLs they always had. From
`lg` up the sections sit in the top bar; below it they are a bottom tab bar with 56px
targets, and the top bar names where you are.

**The Overview answers in order and stops.** The verdict first — Go, Caution or No-go at
display size, in words and an icon as well as a colour — then _What's wrong_ beside
_What's good_, each finding with its evidence and one next action
(`apps/web/src/lib/health-summary.ts`). An unknown input is listed as wrong, never as good.
The figures and the detail sit below the fold on purpose.

**The Map is the repository as an explorable picture.** Two views of one set of facts
(`apps/web/src/lib/repo-map.ts`): _Flow_ runs from the code through the test layers, the
tools and the reports to the verdict; _Packages_ runs from the repository to each package
and its evidence. Nodes are buttons named with their status in words; edges are
decoration. Hover or focus traces a node's lineage, _Show blocking path_ colours the edges
that explain the worst news, and a node opens its evidence. The view, the open node and
the path live in the URL, so a link reopens the same picture. Below `md` the canvas
becomes a list per column. No graph library: the layout is a deterministic column stack
(`map-layout.ts`) and motion is opacity only, off under reduced motion.

## The escape hatches

Three media queries, each its own block rather than one list, because they are three
different requests:

| Query                                  | What it does                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `prefers-reduced-transparency: reduce` | Both borders are pushed to 3:1 against every plane step                                                                    |
| `prefers-contrast: more`               | Muted text moves toward the full foreground; both borders go to the control border. The status hues are **untouched**      |
| `forced-colors: active`                | The borders and the plane are handed to `Canvas`/`CanvasText`, because in forced-colors the two themes are the same screen |

The status hues are left alone in the contrast query for a reason worth stating: they
already clear 4.5:1, and pushing them further would put `--automate-on-fill` below it,
which fixes one contrast request by breaking a different one.

`forced-color-adjust` is not set to `none` anywhere, and there is an assertion for that.
Overriding it is how a component ends up with a colour the user did not choose, which is
the one outcome that query exists to prevent.

## What this site is made of

`site/.vitepress/theme/custom.css` imports `packages/ui/src/tokens/theme.css` and
`fonts.css`. It does not copy them. `pnpm site:doctor` check 8 asserts that the site
imports only token stylesheets the product also imports, that it imports `theme.css`
specifically, and that no literal colour appears in it — so the site and the console
cannot drift into two palettes.

The site is a separate Vite build, so the two font binaries are emitted into its bundle
as well as the app's; they are committed once.
