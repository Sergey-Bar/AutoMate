---
title: The design language
description: The four steps of the plane, what the accent is allowed to do, and which numbers every colour has to clear.
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

## The plane

Four steps, and the names do not change between themes — the plane is what inverts.

| Token                       | Dark      | Light     | What it is for                                                    |
| --------------------------- | --------- | --------- | ----------------------------------------------------------------- |
| `--automate-surface-sunken` | `#08080a` | `#f1f1f4` | The page behind the panels, and the evidence surfaces inside them |
| `--automate-surface`        | `#0b0b0c` | `#ffffff` | A panel. The base                                                 |
| `--automate-surface-raised` | `#131316` | `#fbfbfd` | A control sitting on the base                                     |
| `--automate-surface-muted`  | `#17171b` | `#f4f4f5` | The recessed fill inside a control                                |

In dark mode the plane gets **lighter** as it rises; in light mode it gets **closer to
white**. That inversion is asserted, not described: `theme.test.ts` checks that
`surface-sunken` is the darkest step in both themes, that `surface-raised` lies
strictly between the base and the inset, and that the direction from base to inset is
opposite in the two themes. Re-tuning one value cannot invert the stack without that
failing.

There is no fifth surface. A component that needs one is a component that needs a
token, a contrast case and a name for what the new step is.

### Elevation

Elevation is a shadow that _follows_ the plane, not one that leads it:

| Step | Shadow                                    | For                             |
| ---- | ----------------------------------------- | ------------------------------- |
| `1`  | `0 1px 2px rgb(0 0 0 / 0.32)`             | A card                          |
| `2`  | `0 4px 12px -2px`, plus a 1px `0 1px 3px` | A raised panel, a hover surface |
| `3`  | `0 18px 48px -12px`, plus `0 4px 12px`    | A dialog, a command palette     |

A single `shadow-sm` cannot describe a plane with four levels — it is either invisible
on the base or heavy on the top one — so the scale exists to say _which_ plane token a
surface is painted on.

## The accent

`--automate-accent` is `#3d9bff` in dark and `#1466b5` in light. Measured, it is
`oklch(0.682 0.172 252.9)` — cyan-shifted electric blue.

**It reads as emitted light because of where it is allowed, not because of how it
looks.** The accent is a hairline and a glow:

- the active-run rail,
- the focus ring,
- the `LIVE` pulse,
- a hover underline,
- one bloom behind the Command Center hero.

It is not a large fill and it is not a verdict. A reader who has learned that a
particular colour means a particular thing is being told something else by the same
pixel if the brand colour does double duty.

**The light theme uses the 800 step of the ramp, not the 500.** The dark theme can
afford a light blue on a near-black plane — 6.87:1 — because the contrast is enormous.
The same value on white is 2.86:1, and the accent backs link and button text there, so
it owes 4.5:1 like any other text.

## Run state, and why `info` is not the accent

| Token                | Dark      | Light     | OKLCH hue         |
| -------------------- | --------- | --------- | ----------------- |
| `--automate-success` | `#66bb74` | `#206c32` | 148               |
| `--automate-warning` | `#e4a247` | `#7e5415` | 72                |
| `--automate-danger`  | `#d9716b` | `#9f3331` | 25                |
| `--automate-info`    | `#7c8da6` | `#4d5f79` | 258, chroma 0.048 |
| `--automate-accent`  | `#3d9bff` | `#1466b5` | 253, chroma 0.172 |

`--automate-info` used to be literally `var(--automate-accent)`, which made the brand
colour double as a verdict. It is steel now: the same hue as the accent and roughly a
third of its chroma, so a reader who has learned that a colour means a verdict is not
told something else by the same pixel. The test asserts _categorically_ — info's chroma
must be under half the accent's — rather than picking a number, because the claim is
about being visibly quieter, not about a specific measurement.

The three run states keep 20 degrees or more of hue between them, which is about where
two hues stop being separable by hue alone. Below that the palette is relying on
saturation as well as hue, which is exactly what a reader with a colour vision
deficiency cannot do. `theme.test.ts` measures the hues in OKLab and asserts the
decisions, because a contrast ratio cannot check a hue.

**These are used as body text.** `Alert` and `Toast` render `text-success` over
`bg-success/10`, so they owe 4.5:1 — not the 3:1 a swatch would owe — and a second
4.5:1 against their own 10% tint. The tint raises the background luminance and _lowers_
the contrast, so a ratio computed against the untinted surface would pass while the
shipped rendering failed. There is a test for that case per plane step.

## Two borders, because 1.4.11 is not about every border

| Token                      | Dark      | Light     | Measured                                      |
| -------------------------- | --------- | --------- | --------------------------------------------- |
| `--automate-border`        | `#2a2a2e` | `#e4e4e7` | ~1.3:1 on the base — below 3:1 **on purpose** |
| `--automate-border-strong` | `#66666b` | `#898990` | 3.2:1 or better against every plane step      |

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

## Glass

`backdrop-filter` is an **error** in every `.ts` and `.tsx` file, enforced by
`eslint.config.js`. It makes an overlay a _lens_: it samples the pixels behind it, so
the readability of the thing being read depends on whatever is underneath. For an
evidence console the pixels behind a panel are usually the evidence.

Phase 1 ships no glass at all. When Phase 2 opens the allowlist it is chrome only —
`NavBar`, the app shell, the Command Center, the `Toaster` — and the review rule
`no-glass-over-data` asks the question a linter cannot: not _whether_ there is glass,
but whether what is behind it is data.

## The escape hatches

Three media queries, each its own block rather than one list, because they are three
different requests:

| Query                                  | What it does                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `prefers-reduced-transparency: reduce` | The plane becomes fully opaque and both borders are pushed to 3:1                                                          |
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
