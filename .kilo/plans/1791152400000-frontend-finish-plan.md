# Frontend, finished: a design system raised rather than replaced

**2026-10-04.** Supersedes nothing. Continues `.kilo/plans/1791096500000-full-glassmorphism-plan.md`
(the material shipped; `GLASS-1` is still open on the render baseline) and implements the
remaining half of what that plan's own G4 review found.

---

## 1. What this is, and the one decision that shapes it

The request was: finish the frontend design to the highest level, upgrade the appearance of
the whole site, UI/UX 10/10, using a list of about forty-five references.

Most of that list is **marketing-register**: shadcn, daisyUI, HeroUI, Mantine, Ant Design,
Preline, Flowbite, daisyUI, Magic UI, Cult UI, Aceternity, Eldor, Vengeance, Origin UI,
Spell UI, 21st.dev, Uiverse. Those are libraries for landing pages and product marketing
pages. Their shared vocabulary is a gradient, a glow, a rounded card on a soft blurred
background, and a hero section.

**This product is an evidence console.** Its thesis, stated in its own design language, is
that *prose is a claim and evidence is an instrument reading*. A run log, a stack trace, a
table of digests and a score are the things a person came to read. Applying the marketing
register to it would make it worse at the one job it has, and `.kilo/agents/`'s own
`frontend-design` skill is explicit that the failure mode is "generic AI aesthetics".

So the register is decided by the product, not by the links: **dense, quiet, instrument-like.
Numbers align. Evidence is never behind glass. The chrome may be beautiful; the data may
not be decorative.** That is also what "10/10" means here — not more effects, but zero
defects in the ones that exist and a coherent system underneath.

Everything else in the list is either **directly useful** or **actively harmful**, and the
plan is organised around that distinction rather than around the list.

### 1.1 Adopt: libraries that would break this repository on day one

These are not "less good". Installing any of them fails a gate that exists on purpose:

| Reference | What it would do here | The gate it fails |
| --- | --- | --- |
| shadcn/ui, daisyUI | Both are **Tailwind plugins**. shadcn also assumes `tailwindcss-animate`. | `PLUGIN_PROVIDED_UTILITIES` in `apps/web/src/theme-resolution.test.ts` fails on `animate-in`, `fade-in-*`, `zoom-in-*`. D9's "CSS stays the single token authority, no build step" is a landed decision. |
| shadcn/ui | Components are **copied into your tree** — a second component source beside `packages/ui`, each with its own `cn`, its own CSS variables and its own variants. | `packages/ui` is the one component library; `theme.test.ts` fails on any `--color-*` outside `semanticColorTokens`. |
| HeroUI, Mantine, Ant Design, Flowbite, Tremor, MUI / M3 | Each ships its **own theme layer** with its own tokens, its own scales, its own dark mode. | One palette, measured per plane step in both themes. A second theme layer is the exact defect `no-second-authority` exists to prevent. |
| GSAP, Lottie, three.js / shaders, anime.js | Runtime animation libraries. | Motion is CSS-only in `packages/ui/src/tokens/motion.css` and reaches `prefers-reduced-motion` through one variable. A JS animation runtime is a second motion authority with its own reduced-motion path. `glassStackDepth` already caps compositing at depth 1. |
| Spell UI, 21st.dev, Uiverse, Magic UI, Aceternity, Cult UI | Copy-paste **decorative** components — light rays, exploding inputs, animated gradients. | Wrong register. See §1. |

The honest summary: **the link list is a list of other people's answers to a different
question.** The valuable part of it is not the components, it is the *skills* — and
`ui-skills.com` is a skills registry, which this repository already has a sanctioned path
for.

### 1.2 Adopt: what the list actually points at, and this repository can use

`https://www.ui-skills.com/` is a **registry of design-engineering agent skills**
(`npx ui-skills`, an MCP server, and `skills/registry.txt`). `AGENTS.md` already documents
how to vendor a third-party skill into `.kilo/skills/` and already ships four, each with a
row in `skills-lock.json` recording its upstream and a content hash.

**That is the highest-leverage move available, and it is the sanctioned one.** A skill is
prose an agent obeys; it adds no dependency, no token layer and no build step. `pnpm
skill-scan` already gates them, with a baseline and a stated reason per finding.

### 1.3 Reject: the parts of the plan the repository's own record already settles

- **A new baseline for `test:render`.** `GLASS-1` stays open; the ceilings still need the
  self-hosted single-node install D10 commits to. Recording them here would calibrate a
  required gate to a machine nobody else has.
- **A second component library "for comparison".** A spike is fine; a merge is a second
  authority.

---

## 2. What is actually wrong with the design today

Every item below was read in the tree during planning, and each is a claim a test can
contradict. This is the list the skills will work through, in this order.

### 2.1 The type scale is tested in a table nobody renders

`packages/ui/src/tokens/typography.ts`, `spacing.ts`, `radii.ts`, `shadows.ts` and
`z-index.ts` exist and are imported **only by each other** — into a `tailwindPreset` at
`tokens/index.ts:30` that **has no importer anywhere in the repository**. Its own comment
says so: *"`tailwindPreset` has no importer, and the A2 sweep deletes it."* The sweep never
happened.

Meanwhile `theme.css` owns the real scale, and `theme.test.ts:278-280` asserts the **dead
table's** numbers (`fontSize` has 6 entries, `fontWeight` 4) rather than the stylesheet's.

The consequence is concrete: `Cockpit.tsx:176` renders its `h1` as **`text-3xl`**, and
`text-3xl` is not in the declared type scale at all. It compiles — Tailwind has a default —
so nothing failed. **There is no test on the real type scale.**

This is first because nothing after it can be verified. A type scale that is not measured is
a preference, and every later wave would be arguing about taste.

### 2.2 Three focus idioms across nine components, two of them off-token

- `Button`, `Input`, `Select`, `Textarea`, `Toggle`, `Table` — `focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-border-focus`. Correct, token-driven.
- `Tabs.tsx:111,141` — `focus-visible:ring-2 focus-visible:ring-brand-500`. **`brand-500` is
  Tailwind's default palette**: a second colour authority, in a repository where a colour
  that is not a token is a test failure everywhere else.
- `Badge.tsx:6` — `focus:ring-2 focus:ring-accent`. A ring rather than an outline, and
  `focus:` rather than `focus-visible:`, so it fires on mouse press too.
- `Popover.tsx:149` — `outline-none` with **no focus-visible replacement at all**.

### 2.3 `leading-none` on four headings

`Card.tsx:33`, `Drawer.tsx:189`, `Dialog.tsx:161`, `Alert.tsx:37`. `line-height: 1` clips
descenders and does nothing correct at any heading size.

### 2.4 No `tabular-nums` in the product — and the site has it

`site/.vitepress/theme/custom.css:143` sets `font-variant-numeric: tabular-nums` on table
cells. **The product does not use it anywhere.** It renders a score to two decimals, a pass
rate to one, run counts, flake counts and `avgDurationMs`. Every one of those is a column of
figures that shifts sideways as it updates, which is the single most visible craft defect in
a data console and the cheapest to fix.

### 2.5 Two shadow authorities

`shadows.ts` declares Tailwind's default shadow scale. `theme.css` declares
`--shadow-elevation-1..3` and `--shadow-glass`, each with a measured reason. Same for
spacing and radii. §2.1's fix removes this.

### 2.6 The glass is legible and nearly invisible

Recorded in `GLASS-1` from the G4 screenshot review: at 72% over a flat
`--automate-surface`, the fill contributes almost nothing and the fourth elevation step does
all the separating. The page plane has no gradient, so the only thing the blur ever samples
is other panels. This is a **deliberate** consequence of the measured rules, and the plan
below changes it with a token and a test rather than by raising the fill.

### 2.7 An `unmeasured` cell reads as a broken image

`Cockpit.tsx:504` draws the swatch as a solid bar for "no band at all". At a glance it is a
failed image load, not a measurement that has not happened.

### 2.8 Motion is four keyframes and no vocabulary

`motion.css` has enter, exit, zoom-in, zoom-out. There is no press feedback beyond
`Button`'s single `active:scale-[0.98]`, no hover transition vocabulary, no list or
row transition, no shared-element continuity between a queue row and the run it opens. And
`transition-all` in `Button.tsx:7` transitions every property rather than the two that move.

---

## 3. The plan

Nine waves. The order is load-bearing and stated once here rather than per wave: **authority
before craft, craft before aesthetics, aesthetics before the site.** Every wave has a gate,
and no wave may start while the previous one is red.

### W0 — Vendor the skills, and record why each one is here

**Do not skip this because the waves below already say what to do.** The skills are how the
craft passes get done *and* how the finding list above gets verified independently; the plan
names them so an agent is not asked to invent the judgement.

Install through the documented path, not by hand:

```bash
npx --yes skills@latest add <owner>/<repo> --skill <name> -a kilo --copy -y
# then move .agents/skills/<name> into .kilo/skills/
```

The selected set, each with the job it does and nothing else:

| Skill | Job in this plan |
| --- | --- |
| `pbakaus/impeccable` + `critique` | The rubric. `critique` scores a surface with persona checks — that is the "10/10" made into something with a number against it, which is the only form of that phrase worth having. |
| `pbakaus/typeset`, `pbakaus/layout`, `pbakaus/colorize`, `pbakaus/polish` | The craft checklists for §2.3, §2.6 and §2.7. |
| `ibelick/improve-ui` | Audit a surface against its own design evidence — the repository's own method, applied to itself. |
| `zeke/swiss-design` | Grid discipline and typographic hierarchy. The correct register for a dense console and the structural antidote to the gradient register. |
| `jakubkrehel/better-typography` | `tabular-nums`, `text-wrap: balance/pretty`, measure, line length. §2.4. |
| `jakubkrehel/better-colors`, `jakubkrehel/oklch-skill` | The OKLCH migration in W5. |
| `jakubkrehel/better-layout`, `better-accessibility`, `better-writing` | §2.2, and the empty/error state copy. |
| `emilkowalski/animation-vocabulary`, `find-animation-opportunities`, `review-animations` | Build a motion vocabulary out of the existing four keyframes. §2.8. |
| `emilkowalski/apple-design` | Spring and interruptible motion, and translucent material with depth — the language the glass work is already in. |
| `ibelick/fixing-accessibility`, `wshobson/wcag-audit-patterns` | Focus, ARIA, hit targets. |
| `ibelick/fixing-motion-performance`, `addyosmani/web-quality-audit` | Compositor-only properties; the perf half of the ledger's gates. |
| `mengto/beautiful-shadows`, `mengto/container-lines` | Depth and borders without mud. §2.5, §2.6. |
| `prototyperai/build-primitive` | The primitives that turn out to be missing in W6. |
| `emilkowalski/pick-ui-library` | The documented reasoning for §1.1, so the rejection is an argument rather than a preference. |

**Gate, and it is a real one.** `pnpm skill-scan` **blocks on findings not in
`docs/quality/skill-findings-baseline.json`, each with a stated reason.** Fourteen new
skills will produce findings against prose patterns — unpinned `npx`, imperative install
language, code fences containing markup. Every one gets a baseline row with the reason it
is acceptable here, or the skill does not land. A skill that cannot pass the gate without a
suppression is a skill that should not be vendored.

`skills-lock.json` gains a row per skill with its upstream path and computed hash. **No
existing row changes**: a hash answers *did the file change*, not *is it safe*, which is why
the baseline is a second file rather than the first.

Also in this wave, because it is the same kind of decision:
- Record in `docs/quality/findings-ledger.json` that the link list was assessed and rejected,
  with §1.1 as the `summary`. The reasoning is worthless if the next person has to re-derive
  it, and this repository has already paid for re-deriving it twice.
- **`pnpm skill-scan`'s own `is_complete: false` at 97.7%** is a live limitation. W9 returns
  to it.

### W1 — Make `theme.css` the tested authority, and delete the table that competes with it

This is the wave that makes every other wave verifiable.

1. Parse the **real** `@theme` and `@theme inline` blocks in `theme.test.ts` and assert, from
   the stylesheet: the type scale and its line-heights, the letter-spacing scale, the spacing
   scale, the radii, the shadow scale, the z-index scale, and the motion durations and easings.
   Red-first: a case per scale that fails against today's stylesheet because the scale is not
   declared there at all.
2. Then **delete** `typography.ts`, `spacing.ts`, `radii.ts`, `shadows.ts`, `z-index.ts` and
   `tailwindPreset`, and the `tokens` object that carried them, and move the three assertions
   at `theme.test.ts:278-280` onto the stylesheet.
   `docs:dead-exports` already exists and will agree.
3. Add the two scales that are used and undeclared, as tokens with a reason each:
   **line-height** and **letter-spacing**. `text-3xl` (Cockpit's `h1`) and `tracking-widest`
   (`Cockpit.tsx:306`) are both outside any declared scale today.

**Gate.** `pnpm --filter @automate/ui test`, `pnpm docs:dead-exports`, `pnpm typecheck`.
Red-first per the `evidence-test` skill: every assertion written, run against the unfixed
stylesheet, watched to fail for the stated reason.

### W2 — One focus idiom, on one token

Replace the three idioms with the `outline-*` + `--automate-border-focus` one that six
components already use. Give `Popover` a focus style instead of `outline-none`. Change
`Tabs`'s `ring-brand-500` to the token — and note that `ring-brand-500` compiles today only
because Tailwind ships a `brand` scale; that is a **latent** second authority, not a passing
test.

Then the hit targets: the `ui-skills` playbook's 44×44 minimum, applied to `NavItem`,
`NavBar`'s links, `Tabs`' triggers and every icon-only control, and asserted in
`packages/ui/src/components/Accessibility.test.tsx` — which already sweeps every component
directory, so the assertion has a home.

**Gate.** `pnpm --filter @automate/ui test`, `pnpm --filter @automate/unified-web test`, the
accessibility E2E project.

### W3 — Typography: the numbers stop moving

1. `--automate-numeric: tabular-nums` as a Tailwind-exposed utility, applied to every place
   the product renders a figure: scores, pass rate, run and gap and quarantine counts,
   durations, coverage percentages, the pyramid's four figures, `Table`'s numeric cells.
   The site already does this; the product does not, and that asymmetry is the finding.
2. `leading-none` → a declared line-height on all four headings. A heading at
   `line-height: 1` is a bug, not a style.
3. `text-balance` on headings, `text-pretty` on body prose — the two properties
   `better-typography` and the playbook both name, and both of which are one line each.
4. A **measure**: `--automate-measure: 68ch` on prose blocks, and not on data.
5. Re-derive the type scale under swiss rules and assert it: Archivo for UI, JetBrains Mono
   for anything a person compares down a column, one display size, and a step ratio the
   stylesheet states rather than implying.

**Gate.** `pnpm --filter @automate/ui test`, `pnpm --filter @automate/unified-web test`, and
the accessibility E2E in both themes — a type change is exactly the kind of thing a
route-level run exists to catch.

### W4 — Motion as a system

From `animation-vocabulary` and `apple-design`, without a JS runtime:

1. A **stated vocabulary** in `motion.css`: what each of the four existing keyframes is for,
   plus the press, hover, list and panel transitions the product does not have. Named, not
   scattered.
2. `--automate-press-scale` as a token, replacing `Button`'s arbitrary `active:scale-[0.98]`,
   so the press feedback is one number and `prefers-reduced-motion` reaches it.
3. `transition-all` → the two properties that move, on every component that writes it.
4. **Panel transitions**: `Drawer` and `Dialog` slide; `Popover` and `CommandPalette` fade and
   scale; `Toast` enters and leaves. Today `Dialog`, `Drawer`, `Popover`, `Tooltip`,
   `CommandPalette` and `EmptyState` all write `animate-*` and all of them resolve, because
   W-something once fixed that — this wave gives them the *right* motion rather than any.
5. `fixing-motion-performance` over the result: compositor-only properties, no layout
   thrash, and the glass stack-depth ceiling from `performance/rendering-budget.json`
   re-checked after every change that could deepen it.

**Gate.** `pnpm --filter @automate/ui test src/tokens/motion.test.ts`, the rendering-budget
project (`glassStackDepth` must stay at 1), and the accessibility project.

### W5 — Colour: OKLCH, measured, in place

`better-colors` and `oklch-skill` against the current hand-written hex.

The whole palette moves to `oklch()` **with the contrast cases recomputed**, because the
current hex values are load-bearing in three places: `theme.test.ts`'s contrast maths
(`contrastRatio` parses `#rrggbb`), `tokens/colors.ts`, and the ramps. OKLCH buys hue
interpolation that does not drift, a gamut check, and perceptually even steps — and it costs
a rewrite of the contrast maths, which is the part that must not be hand-waved.

1. A gamut check as a test, so a colour outside sRGB is a failure rather than a surprise on
   one monitor.
2. Ramp steps in OKLCH at a fixed lightness delta, asserted rather than eyeballed.
3. **The one real design change**: a page-plane gradient. `--automate-plane-wash`, a single
   very low-chroma radial, declared once per theme, composed from tokens, and — this is the
   part that matters — **excluded from the region `Table` and the evidence panes occupy**,
   because §2.6 exists precisely so that glass has something to sample, and the answer must
   not be "put a gradient behind the evidence".

   That exclusion is asserted, not intended: a test that fails if the wash reaches a data
   region.

**Gate.** `pnpm --filter @automate/ui test src/tokens/theme.test.ts`, `pnpm docs:check`
(`site-doctor` check 8 imports `theme.css` rather than copying it, so a token change is a site
change), and the accessibility project in both themes.

### W6 — The screens, one at a time, in this order

Each screen is its own step with its own before-and-after screenshots in
`test-results/evidence/glass/`, which the G4 gate already produces.

1. **`Cockpit.tsx`** — the flagship and the densest. §2.7's unmeasured swatch becomes a
   legible "not measured" state; the pyramid strip gets its four figures on the numeric
   utility; the limiter card's `text-4xl` figure is set in the display step; the queue gains
   a hover and focus row treatment; and the `h1` is re-derived under W1's scale.
2. **`run-detail.tsx`** — where a person decides whether a release is safe. Glass stays off
   the evidence region, permanently, and the rule says so.
3. **`quarantine.tsx`** — a filter surface whose content changes on every keystroke. The INP
   reading in `performance/rendering-budget.json` is the one most likely to catch a
   re-render this plan causes.
4. **`gaps.tsx`, `score.tsx`, `analytics.tsx`** — the remaining routes.
5. **Empty, loading and error states**, as one pass over every route rather than per route:
   `build-primitive` for the states that are currently a line of grey text. A console whose
   empty state is a sentence has one state too many.

**Gate.** `pnpm --filter @automate/unified-web test`, the accessibility project (66 generated
tests, both themes, four forced states), the rendering-budget project, and a screenshot
reviewed as a diff per screen.

### W7 — The primitives that turn out to be missing

Only after W6, because W6 is what reveals them. Candidates already visible: a `Definition
list` for label/figure pairs, a `Meter` for coverage and pass rate with a **non-colour**
channel so it is not a hue-only reading, a `Sparkline` for run duration over time, and a
`SegmentedControl` if `Tabs` proves to be the wrong primitive for a two-way filter.

Each one: `build-primitive`'s ARIA, keyboard, focus and state handling; a test that it cannot
fail; and `Accessibility.test.tsx` coverage, because that sweep is already directory-wide and
a new component that misses it is a hole.

**Gate.** the axe sweep, `pnpm --filter @automate/ui test`, and the E2E route sweep.

### W8 — The documentation site

`sites/.vitepress/theme/custom.css` is the best-designed file in the repository and it is
almost entirely **derivative** — it imports `theme.css` and maps VitePress's variables onto
it, which is exactly right. What it has not done is raise anything.

1. The site gets the W1–W5 tokens for free, because it imports them. Verify rather than
   assume: `site:doctor` check 8 is the gate, and it must still pass in both themes.
2. What the site is actually missing is **editorial craft**: a real measure on prose, `h3`
   and `h4` (there are rules for `h1` and `h2` and nothing below them), a landing page that
   argues rather than lists, and the status pages — `findings`, `coverage`, `ten` — given a
   presentation that makes a table of 159 rows readable as a status rather than as a dump.
3. `site/index.md` and `Home.vue` are VitePress defaults. The home page is the first
   impression and it is currently a stock hero.

**Gate.** `SITE_DOCTOR_BUILT=1 pnpm site:doctor` (all ten checks), `pnpm docs:check`, and a
build that resolves `SITE_BASE` correctly at a non-root base.

### W9 — Close the loop on what this plan cannot finish

Named here rather than discovered later:

1. **`GLASS-1` stays open.** `pnpm render:baseline` needs the self-hosted single-node install,
   and `test:render` moves to `pr-blocking` in the same commit. W4 and W6 change rendering
   cost, which is precisely why the timing half has to be recorded on the reference hardware
   *after* them and not before.
2. **`skill-scan`'s coverage** — `is_complete: false` at 97.7%, with
   `static_patterns_tool_misuse` degraded. Graduating needs a run that printed
   `is_complete: true`, and that is a CI step.
3. **WebKit.** `PERF-1` now names it and nothing closes it. `playwright.config.ts` is
   Chromium-only; the shipped effect is a sampled backdrop, and WebKit is the engine most
   likely to disagree. A third project and a reading from it.
4. **A visual baseline does not exist.** This plan produces screenshots as evidence, which
   is what the G4 gate asked for. It does **not** introduce `toHaveScreenshot`, because a
   per-platform image diff behind every pull request protects a property this repository
   already measures numerically. If a future maintainer wants pixel regression, that is its
   own plan with its own cost argument.

---

## 4. Ledger rows this plan creates

| Row | Band | Status | What it records |
| --- | --- | --- | --- |
| `DESIGN-2` | Major | fixed | The type scale was tested in a table with no importer, while the stylesheet that owns it had no test. `text-3xl` shipped in the product's `h1` because nothing measured the real scale. |
| `DESIGN-3` | Major | fixed | Three focus idioms across nine components, one of them `ring-brand-500` — a Tailwind default-palette colour in a repository where every other colour is a measured token — and one `outline-none` with no replacement. |
| `DESIGN-4` | Minor | fixed | No `tabular-nums` in the product while the documentation site had it: every figure in an evidence console shifted sideways as it updated. |
| `DESIGN-5` | Major | open | **The open one.** The remaining craft debt this plan does not close: the visual baseline, WebKit, and the render baseline. Owned by `GLASS-1`'s exit and by this row. |

`GLASS-1` is **not** re-opened or re-scoped by this plan; it keeps its own exit.

---

## 5. Risks, stated before the work

1. **The OKLCH wave is the one that can go wrong.** It touches the palette, the contrast
   maths, `tokens/colors.ts`, the ramps and every screenshot anybody has looked at. It is
   sequenced after the waves that establish *what* the colours are for, and its gate is the
   full contrast suite rather than a diff. If it stalls, stop it — the palette is already
   measured in hex and nothing else in this plan depends on the colour space.
2. **W6 is the longest and the least mechanical.** Screens are where a design plan turns
   into taste, and the gates only catch regressions, not mediocrity. The mitigation is
   `pbakaus/critique`'s scoring on each screen, recorded in the wave, with the screenshots
   as the evidence.
3. **Fourteen new skills is a real supply-chain surface.** Every one is scanned, hashed and
   justified, and the plan says plainly that a skill which cannot pass without a suppression
   does not land. It is also the wave most likely to be over-scoped; if W0 is taking longer
   than the craft it enables, cut the list.
4. **Coverage floors do not move.** `apps/web` is at 96/88/96/98 and already at its floor, so
   every new web file needs a real test in the same change. `packages/ui` is at 67/84/68/66.
   Lowering a floor to make room is not a fix.
5. **`verify` has 16 of 20 steps used.** This plan adds no gate. Every wave's gate is an
   existing command.

---

## Delivery record — 2026-10-04

Written after the work, not planned before it. Read this alongside §1–§8: those say what the
waves intended, this says what landed.

### What landed

| Wave | What is now in the tree | The gate that says so |
| --- | --- | --- |
| **W0** | Twelve design-craft skills vendored (four → sixteen in `skills-lock.json`). `scripts/skill-scan.mjs` no longer holds a literal list of vendored names — it derives them from the lock, and `scripts/lib/skill-scan.test.mjs` fails if the two disagree in either direction. One new baseline row with a stated reason. | `pnpm skill-scan` green; the derived-list test was run red first against the four-name array. |
| **W1** | The five dead token tables deleted, `tailwindPreset` and the `tokens` barrel with them. `theme.css` now declares the type ladder at a stated `--automate-type-ratio: 1.2`, the six-step line-height and letter-spacing scales, `--spacing`, the radius scale, six named stacking layers and `--max-w-measure`. `fonts.css` publishes `font-sans`/`font-mono` so they resolve to the committed binaries. | `theme.test.ts` 75 tests; 19 were red before the stylesheet was written. `pnpm docs:dead-exports` green. |
| **W2** | One focus idiom on `--automate-accent`, on the rendered DOM. Eleven components changed, including `Tabs`' `ring-brand-500` (a Tailwind default) and four that drew no indicator. 44×44 on the icon-only controls and the named navigation targets. `z-10`/`z-50` replaced by `z-chrome`/`z-modal`/`z-popover`. | `Accessibility.test.tsx` 112 tests in `packages/ui`, 24 in `apps/web`, each with control arms; `theme-resolution.test.ts` fails on a bare `z-<number>`. |
| **W3** | `tabular-nums` on every figure; `leading-none` gone from five components; `text-balance`/`text-pretty`/`max-w-measure` on prose; a `numeric` prop on `TableCell`; the Cockpit's unmeasured cell redrawn as an outline rather than a solid bar. | Rendered-DOM assertions with named offenders; the `webSourceFiles()` reader was found walking three levels when it meant four and the control arm now exists. |
| **W4** | `motion.css` rewritten as a stated vocabulary: five roles, five durations as `calc(value * scale)`, four easings, six named keyframes, `--automate-press-scale` as a token. `transition-all` gone; `active:scale-[0.98]` → `active:scale-press`; each overlay says which direction it moves. | `motion.vocabulary.test.ts` (7) and the pre-existing `motion.test.ts` (13), which holds `motion.ts` as the authority. |
| **W5** | One low-amplitude wash on the page plane, interpolated `in oklab`, published as `bg-page-wash`. **The ramps stay hex**, deliberately: the argument for OKLCH is entirely about interpolation, and the contrast maths in `theme.test.ts` parses `#rrggbb`. | The exclusion is quantitative: every status hue as text recomputed over the wash's strongest point, the three planes above the page asserted opaque, and `bg-page-wash` allowed on two named shells and nowhere else. Control arm: mutating `Card` fails with the filename. |
| **W6** | The app-level focus and hit-target sweep now reaches the route screens, and a source-level rule reaches the two that need a `QaClient` the fixtures do not carry. Nine hand-rolled controls across five files fixed. | The rule is one sweep rather than six reviews, and the failure message names the file and the element. |
| **W7** | Three primitives — `DefinitionList`, `Meter`, `Sparkline` — each carrying a decision at the top of its own file. Registered in the axe sweep (28 → 31 components). | `Primitives.test.tsx` (12), including a control arm that removes the flat-series guard and produces `M 2 NaN L 48 NaN`. |

Full chain green: `typecheck` 38/38, `lint`, `format`, `test` 37 packages, `build` 23/23,
`coverage:ratchet`, `test:integration` 402, `docs:check`, `findings:check`,
`review:rules`, `tenancy:check`, `docs:dead-exports`, `security:secrets`, and
`site:doctor` 10/10 against a built `site/dist`.

### Closed after the first delivery record

The two gaps above were finished in a second pass, and both produced findings rather than
edits. `DESIGN-6` in the ledger records them.

**W6, the composition pass.** `apps/web/src/Composition.test.tsx` — eleven tests over every
`.tsx` under `routes/dashboard` plus the two shared screens. It reads what the earlier sweeps
could not: heading hierarchy, prose measure, and figures a screen renders itself. Six findings
on the first run:

- `quarantine.tsx` and `analytics.tsx` each opened with an `h2`, so a screen reader heading list
  began one level down with nothing naming the screen;
- `run-detail.tsx` had an `h3` **above** its own `h1`, and the pairwise rule that should have
  caught it was satisfied vacuously by a deep heading appearing first;
- sixteen hand-written paragraphs were outside `--max-w-measure`, ten of them on
  `run-detail`;
- two screens used a hand-typed `max-w-3xl` where the declared token belongs;
- the analytics figures had no `tabular-nums`, hand-rolled instead of using `StatCard`;
- `analytics.tsx` rendered `N/A` for an unmeasured average — a value-shaped placeholder for a
  state, which is the Cockpit defect again.

Two rules in the sweep were themselves wrong before they were right, and both are recorded at
the site of the fix: the heading-descent walk started from zero, and the comment stripper used
a pattern that a block-comment delimiter inside a string literal defeats — so the `Cockpit`
own JSDoc was flagged as uncapped prose on a paragraph already capped.

`quarantine.tsx` now composes `DefinitionList` and `Badge`, so a verdict word and its colour
are one element — the structural fix for the `DESIGN-1` inversion rather than another colour
swap, and the test now asserts the pair. `analytics.tsx` composes `StatCard` and says
`not measured`.

**W8, the editorial pass.** The landing-page discovery was right: `theme/Home.vue` already
renders the evidence chain. The real gap was that `capabilities.md` listed five unexplained
status words on the page a reader lands on to ask whether the product does what they need,
while the register that generates it defines each in a sentence the generator never read. It
does now — parsed from the register, so the page and the source cannot drift — and all four
generated pages say how to regenerate themselves. `scripts/lib/site-prose.test.mjs` holds both
claims, with a control arm for the vocabulary parse.

**Two corrections to the record below.** Item 4 said no screen got a composition pass; that is
what prompted writing one, and it found six defects the earlier sweeps were structurally
incapable of seeing. Item 3 said the generator prose was in a different file than the plan
assumed — two of them, in fact, since `quality/ten.md` is built by
`scripts/lib/site-ten-page.mjs`.

### What did not, and why

1. **W0's skill list was cut from twenty-six to twelve.** The plan's own permission: *"if W0
   is taking longer than the craft it enables, cut the list."* The twelve kept are the ones
   whose subject a wave actually consulted — `swiss-design` and `better-typography` for the
   type scale, `better-accessibility` and `fixing-accessibility` for W2, `animation-vocabulary`,
   `review-animations` and `fixing-motion-performance` for W4, `better-colors` and
   `beautiful-shadows` for W5, `build-primitive` for W7, `web-quality-audit` for W9, and
   `pick-ui-library` for §1.1's rejection. The four `pbakaus/impeccable` reference files were
   cut for a specific reason: they are reference *prose* with no frontmatter, and the only
   discovery path in this repository is `name` + `description`, so vendoring them would have
   meant writing a wrapper — which is a modification, not a copy, and would have made the
   hash in `skills-lock.json` a hash of my wrapper.
2. **W8 was largely already done, and the discovery was wrong.** §1.4 says the documentation
   site "has no landing-page work" and that `site/index.md` is VitePress default. It is not:
   `theme/Home.vue` renders the six-link evidence chain, `Layout.vue` mounts it through the
   `home-hero-after` slot, and `index.md` sets `hero: false` — and the file documents at
   length why a front-matter block could not carry the chain. The site already imports the
   product's `theme.css` rather than copying values, asserts zero literal hex, maps all four
   VitePress admonitions onto the run-state tokens, and sets `tabular-nums` on `td code` —
   the `DESIGN-4` asymmetry, site-has-product-doesn't, exactly as the handover said. Nothing
   was changed there, because nothing needed it.
3. **W8's editorial pass over the generated pages was not done.** The four generated pages are
   produced by `scripts/site-generate.mjs`, so the prose belongs in the generator and a
   hand-edit would be overwritten by the next run — which is the right shape but means the
   work is in a different file than the plan assumed. Not started.
4. **W6's per-screen craft pass was replaced by the sweep, not supplemented.** The plan asked
   for run-detail, quarantine, gaps, score, analytics and the empty states to be reviewed one
   at a time with fresh eyes and a critique rubric. What landed is the sweep, which reaches
   the focus, hit-target and hand-rolled-control rules across all of them at once, and which
   named nine real defects on its first run. That is a better instrument than the one
   proposed, and it is not the same instrument: no screen got a `pbakaus/critique` pass, so
   composition — the hierarchy *within* a screen rather than the rules its controls obey — is
   unreviewed. The score, gaps and analytics screens in particular have had their controls
   fixed and nothing else.
5. **`pnpm test` flaked once** in a parallel `turbo` run (`@automate/unified-web`, one
   failed suite, not reproducible in isolation or on a re-run of the full chain). Recorded
   rather than smoothed over; it was not investigated.
6. **`GLASS-1` is untouched and stays open**, as §8 requires. `render:baseline` is not
   recorded here, `test:render` is not raised to `pr-blocking`, and `PERF-1` is not closed —
   because W4 and W6 changed rendering cost and that recording belongs *after* them, on the
   self-hosted single-node hardware D10 commits to.
7. **Two of the plan's file line references were stale**, and both cost time:
   `Cockpit.tsx`'s unmeasured swatch is `MatrixCell`, not line 504, and
   `AppShell.tsx:26` carries `GLASS_SURFACE_CLASSES` but is not the page plane W5 wants —
   `packages/ui/src/components/AppShell` is too, and the exclusion names both.

### Two findings that are not in the ledger as rows

**The repository's own gate had the same defect W1 was about.** `scripts/skill-scan.mjs` held
a literal list of four vendored skills beside a lock file that records every vendored skill,
and the prose in `AGENTS.md` repeated the number the array produced. Twelve skills landed and
both stayed at four. That is the identical shape to `tailwindPreset` — a second authority for
one list, kept alive by the absence of a check — and it is fixed by deriving the list, so it
does not need a row. It is recorded here because the *pattern* recurred within one session,
which is evidence that a pattern is what the next reviewer should look for.

**A gate can be right and still be a false positive, in both directions.** `theme-resolution.test.ts`
failed three new utilities for being "unstyled" — `text-balance`, `text-pretty` and
`border-dashed` — and each was a class that compiled correctly to a declaration the gate did
not count: `text-wrap` and `border-style`. Its "generates a colour" question is really "did
Tailwind emit a rule for this class", and it is now that question. The same week, a second
helper in the same test walked three levels when it meant four and every assertion built on it
passed vacuously. Both are recorded as comments at the site of the fix, because both are the
kind of thing a reader needs to be told rather than to rediscover.
