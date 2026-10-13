# Cinematic design language + documentation overhaul

Supersedes **D13** (`1790399792791-…roadmap.md`) and **D16**
(`1790509811211-…stabilization-release.md` §6). One design authority, recorded once,
here.

## Why this is not the work the newest plan rejected

`1791000000001-automate-practical-10-of-10-plan.md:202` says: *"Do not do the
glassmorphism redesign. It is a month of visual work that changes no verdict."*

That objection is answered by scope, not by argument. This plan carries:

- the gates §6 already specified (`no-glass-over-data`, reduced-transparency
  fallbacks, Storybook visual regression, the `test:render` ordering constraint), and
- the eight real defects a token pass touches anyway.

A plan that only swapped hex values would be rejected on the same grounds.

---

## 1. Decisions

| # | Decision | Replaces |
|---|---|---|
| **D6-1** | Neutral near-black plane with **zero blue cast**; the accent reads as emitted light, not as a blue theme | the Tailwind-500 defaults at `theme.css:50-53` |
| **D6-2** | Accent is cyan-shifted electric blue `oklch(0.72 0.17 250)` ≈ `#3D9BFF`. Appears as the active-run rail, focus ring, LIVE pulse, hover underline and one bloom behind the Command Center hero — **rarely as a large fill** | `--automate-accent: #3b82f6` (blue-500) |
| **D6-3** | `--automate-info` decouples from accent to steel `#7C8DA6`. **The brand accent is never a verdict** | `theme.css:23`, where `info` is literally `var(--automate-accent)` |
| **D6-4** | Run-state palette restated off Tailwind 500 into evidence-calm values, hue-distinct from the accent (green ≈145°, amber ≈75°, red ≈25°, accent ≈250°) | `#22c55e` / `#f59e0b` / `#ef4444` |
| **D6-5** | Archivo variable (`wght` 100-900, `wdth` 62-125) + JetBrains Mono. Two families. Self-hosted, sha256-locked, preloaded, latin subset, woff2 only | Inter named at `index.css:23` and **never loaded** — the app renders in the OS stack today |
| **D6-6** | **Glass is chrome, never data.** Allowlist only (§4) | D16's rule, preserved verbatim in substance — **instrument superseded, observation kept**: a total ban became a measured allowlist plus `glass-over-unstable-backdrop`; see §4 |
| **D6-7** | Docs site keeps a light chrome with dark evidence panels; adopts the product palette verbatim | D13's *aesthetic*. **D15 is untouched** — the site still sells the evidence guarantee, still may not claim a capability whose register row is not `real` |
| **D6-8** | CSS stays the single token authority. No build step, no class-name migration | D9, preserved |
| **D6-9** | **The effect ships in two phases.** Phase 1 is opacity, elevation and type with **no `backdrop-filter`**. Phase 2 is the effect, and is blocked on `PERF-1` | ordering constraint 8, which cannot be satisfied today — **superseded 2026-10-04**: the constraint was right and the phase it gated was wrong. Glass shipped under a *structural* budget (`glassStackDepth`, compared in every phase) while the *timing* half stayed the exit criterion, recorded as `GLASS-1` |

### D6-9 is the crux — read this before scheduling Phase 2

Ordering constraint 8 says the rendering budget must land *before* the effect. But
`performance/rendering-budget.json:44` is `recorded: false` with every ceiling `null`,
`render:baseline` is `never-in-ci`, and `PERF-1` is an `open` row that only closes on a
self-hosted single-node install — a GitHub runner is not that hardware.

So the constraint cannot be satisfied now. The honest resolution is to **not ship
`backdrop-filter` in this plan**. Phase 1 delivers the entire visual language with
zero backdrop-filter: the neutral plane, the accent-as-light discipline, Archivo,
elevation by token, and motion. Phase 2 is a separate, smaller commit whose entry
criterion is a recorded `render:baseline`. Anything else ships the effect on instinct,
which is the exact failure the constraint was written to prevent.

> **Superseded 2026-10-04.** The reasoning above is kept because it was right about the
> risk and wrong about the shape of the gate, and both halves of that are worth reading.
> It made a **timing** measurement the entry criterion for a **structural** change, so the
> only two available moves were "block forever" and "ship against nothing". The glass plan
> takes a third: a structural ceiling that can be measured today
> (`glassStackDepth`, depth 1 on all four routes) gates the change, the route-level axe
> gate runs first so legibility is measured rather than argued, and the timing readings
> become the exit criterion — open as `GLASS-1`.

---

## 2. Phase 1 — tokens (the single authority)

`packages/ui/src/tokens/theme.css` is the only place a colour value is written
(`D9`/`D8-6`).

**Plane** — add, replacing the single `--automate-surface`:

```
--automate-surface-sunken   #08080A
--automate-surface           #0B0B0C   /* base — neutral, no blue cast */
--automate-surface-raised   #131316
--automate-surface-muted    #17171B   /* elevated */
```

**Accent ramp** — `blue` in `tokens/colors.ts` becomes 11 steps anchored on `#3D9BFF`
(the `defines an 11-step ramp for every hue` assertion at `theme.test.ts:142` requires
exactly 11, named 50…950).

**Restated run state** — `--automate-success`, `--automate-warning`,
`--automate-danger`, `--automate-info`. `--automate-on-fill` becomes **dark**
(`#0B0B0C`) because the accent is light; `theme.test.ts:372-391` asserts on-fill
contrast against accent, success, warning and danger at ≥4.5.

### Two traps in the token gate

1. **The border assertion is an inversion guard.** `theme.test.ts:414` asserts
   `--automate-border` measures **below** 3:1, with a comment at `:393-403` saying to
   flip it when the ramp is re-tuned. A cinematic plane needs a visible edge on
   `--automate-surface-raised`. **If the border is raised, that assertion must be
   flipped in the same commit** — otherwise the suite fails on a deliberate
   improvement.
2. **`theme-resolution.test.ts:320` has a floor of 40 colour candidates and names five
   classes that must stay discoverable**: `bg-error`, `text-error`,
   `text-text-muted`, `bg-brand-50`, `bg-bg-base`. Renaming any of them breaks a suite
   that is not about design. Leave the names alone.

Every new token needs a contrast case in `theme.test.ts` — the eleven assertions are
hand-written, so a new token is **unmeasured until someone adds it**. 4.5 for text, 3
for borders/swatches/focus rings, 4.5 against a 10% sRGB tint for status colours.

---

## 3. Phase 1 — type

Canonical font directory: `packages/ui/src/assets/fonts/`. Both consumers import from
it, so the binaries are committed once.

- `packages/ui/src/tokens/fonts.css` — `@font-face` for Archivo variable and JetBrains
  Mono, `font-display: swap`, plus `size-adjust`/`ascent-override` on a local fallback
  so the swap does not move a line. Metrics-override fallbacks are what keep CLS at 0.
- `apps/web/index.html` — `<link rel="preload" as="font" type="font/woff2" crossorigin>`
  for the two files used above the fold.
- `packages/ui/src/tokens/typography.ts` — already names Inter and JetBrains Mono; it is
  dead code (`tailwindPreset` at `tokens/index.ts:19-34` has no importer — see A2) but
  **do not delete it in this plan**. Delete with the A2 sweep, not here.

**Verify before committing binaries:** `scripts/secret-scan.mjs` walks the working tree
and `security:secrets:history` walks every commit. Confirm a `.woff2` is skipped by
extension; if it is not, add the extension to the scanner's skip list in the same commit
rather than discovering it in a red hook.

---

## 4. Glass — chrome, never data (D6-6)

> **SUPERSEDED by `.kilo/plans/1791096500000-full-glassmorphism-plan.md`.** What is struck
> is D6-6's *instrument*, not its observation. "Glass is chrome, never data" was right and
> is still what ships. What was wrong was enforcing it as a **total** ban on the property,
> because a linter can ask whether an element has a `backdrop-filter` and cannot ask what is
> behind it — so the rule could not name the cases it permitted, and a prohibition with no
> exceptions trains reviewers to route around it. The glass plan replaces it with a measured
> rule: five tokens in `theme.css`, a contrast case that composites the fill over every plane
> step in both themes, an `eslint.config.js` `GLASS_ALLOWLIST` the ban's negative lookahead is
> derived from, and a review rule — `glass-over-unstable-backdrop`, replacing
> `no-glass-over-data` in the same category and severity — that asks the answerable question.
> `PERF-1` is no longer this phase's entry criterion; it is now the exit criterion, recorded as
> `GLASS-1`. Steps 17–18 below are what the glass plan executes.

`backdrop-filter` is permitted in these and nowhere else:

`AppShell` header · `Sidebar` · `Dialog` · `Drawer` · `Popover` · `Tooltip` · `Toast` ·
`CommandPalette` · the Command Center hero stat tile.

Forbidden: `Table`, `run-detail.tsx` content, every monospace or tabular-numeral run,
and any log, stack-trace, diff, evidence, screenshot, code or JSON pane.

Enforced, not conventional:

- New `no-restricted-syntax` block in `eslint.config.js`, modelled on the D-9
  double-assertion ban at `:230-258`. There is **no `packages/ui/**` block today** other
  than the two `*.tsx` jsx-a11y ones at `:199-211` and the Splitter carve-out — so this
  is a new `files:` entry, not an edit.
- `no-glass-over-data` in `.github/review-rules/rules.json`, seven required fields
  (`scripts/review/ruleset.mjs:107-143`), `category: "Boundary design"`, `severity:
  "Major"`, `pathGlobs` naming the forbidden components.

### Escape hatches, each with a test

`prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors`
all degrade glass to an opaque surface. `prefers-reduced-motion` already exists at
`motion.css:33-40` and must not be duplicated.

### Phase 2

Superseded. The glass itself is built: one `backdrop-filter` pair in `theme.css`, a
blur-radius ceiling in the token, and a per-route cap on nested translucent surfaces in
`performance/rendering-budget.json`. The original entry criterion — `PERF-1` closed — was
the right instinct pointed the wrong way: it made a **timing** measurement the gate on a
**structural** change, so the honest options were both bad (block forever, or ship against
nothing). The split is that `glassStackDepth` is a count and is compared in every phase,
while the four LCP/INP/CLS/long-task readings wait for reference hardware and are now the
exit criterion rather than the entry one.

---

## 5. Phase 1 — motion, and the 13 utilities that do not exist

`animate-in`, `fade-in-0`, `fade-in-90`, `fade-in`, `zoom-in-95` ship in 7 files with
**no `@keyframes` anywhere in the repo and no `tailwindcss-animate` plugin**. They
resolve to nothing. The roadmap's own defect list calls this out at
`1790399792791:70`.

Declare them as Tailwind v4 theme tokens rather than adding a dependency:

- `@keyframes` for enter/exit in `packages/ui/src/tokens/motion.css`
- `--animate-*` entries in the `@theme` block
- replace the class names in `CommandPalette.tsx`, `Tooltip.tsx`, `Dialog.tsx`,
  `Drawer.tsx`, `Popover.tsx`, `EmptyState.tsx`
- extend `theme-resolution.test.ts`'s `REMOVED_IN_TAILWIND_V4` list to cover
  plugin-provided utilities, so this class of bug cannot recur

A4 permits the pinned plugin as an alternative. Prefer the tokens: D9 forbids a layer
that can drift, and this keeps the dependency count flat.

---

## 6. Phase 1 — components

Apply the new plane, accent and type to the shell and the primitives. Priorities by
how wrong they are today:

1. **Three hardcoded palette classes bypass the token system** —
   `quarantine.tsx:59,110` (`bg-blue-600` / `hover:bg-blue-700`) and `:134`
   (`text-yellow-600`). They render the wrong blue in dark mode and **invert the hover
   affordance**.
2. **Quarantine state semantics are inverted** — `quarantine.tsx:187-193` renders
   `approved` as `text-error` and `rejected` as `text-success`.
3. **Two competing loading/empty/error families.** `apps/web/src/components/shared/`
   holds `EmptyState.tsx`, `ErrorState.tsx` and `LoadingState.tsx`; the last uses inline
   styles and no Tailwind. Delete the three and adopt the `packages/ui` ones, updating
   their call sites.
4. **`gaps.tsx:51` renders a bare `<Skeleton />`** — the `block` variant has no
   dimensions, so it collapses to 0 height and is invisible.
5. **`apps/web` uses zero icons.** `NavBar.tsx:37` renders `Theme: {theme}` as text
   while `ThemeToggle.tsx` exists, is tested, and is rendered by nothing.
6. **Emoji violate the repo's zero-emoji convention** — `ThemeToggle.tsx:19-21`,
   `ErrorState.tsx:23`, `Table.tsx:97-100`, `StatCard.tsx:34-36`, `Sidebar.tsx:35`. Three
   icon conventions coexist (numeric `size`, `h-5 w-5`, `h-4 w-4`). Add one `Icon`
   wrapper and a `strokeWidth` scale.
7. **Run detail is the densest screen and the one that decides a release.** Keep it
   fully opaque and mono; this is where D6-6 earns its keep.
8. `DESIGN-MAP.md:11,15` documents a `Kbd` and an `ErrorBoundary` that do not exist.

A5 also extends `theme-resolution.test.ts` to scan `apps/web/src` — today it scans
`packages/ui/src/components` only, so **zero `apps/web` colour utilities are verified**.
Do that in this phase or the token system is not actually enforced where the defects
above live.

---

## 7. Phase 1 — gates

| Gate | Action |
|---|---|
| `theme.test.ts` | contrast cases for every new token; flip the border inversion guard if the border is raised |
| `theme-resolution.test.ts` | add `apps/web/src` to the scan; extend `REMOVED_IN_TAILWIND_V4` |
| `eslint.config.js` | new `packages/ui/**` + `apps/web/**` glass-ban block |
| `.github/review-rules/rules.json` | `no-glass-over-data` |
| escape hatches | one test per media query asserting the opaque fallback |
| `coverage:ratchet` | `packages/ui` 67/84/68/66 and `apps/web` 96/88/96/98 must not regress. Every new or changed component needs a test on the same PR |
| Storybook | **`.storybook/main.ts` and `preview.ts` do not exist.** `packages/ui/package.json:13-14` declares `storybook dev -p 6006` and `storybook build`; both fail today. The 28 `.stories.tsx` files exist and render nowhere. Create the config, and **import `theme.css` in `preview.ts`** — otherwise the token contract is unverified in Storybook and visual regression compares unstyled markup |
| `verify` | **do not add a step.** It is at 16 of a hard 20 (`gate-tooling.mjs:614-629`). New scripts are tiered in `scripts/gate-tooling.json` and stay out of `verify` |

---

## 8. Phase 1 — documentation

### Site

`site/.vitepress/` contains **only `config.mts`**. There is no `theme/`, no CSS, no
tokens, no logo, no favicon, no OG image, no admonitions, 8 pages, 4 generated, and no
section landing pages.

- `site/.vitepress/theme/` — custom CSS importing the **product palette from
  `packages/ui`** (never a second copy), the two fonts through Vite so the binaries are
  emitted once, and `Home.vue`.
- Home hero is a **real evidence chain**, per D15 — not a feature count.
- Per-section landing pages for `guide/`, `pages/`, `pages/quality/`.
- Admonition containers (`::: warning`, `::: danger`) — currently zero; callouts are
  bold lead-ins in prose.
- Extend **`site-doctor` check 8** to assert the site's tokens conform to
  `packages/ui`, so the two cannot drift. Check 8 currently has no implementation to
  extend — read it before relying on it.

### Root docs

Restructure `README.md`, `CONTRIBUTING.md`, `AGENTS.md` for the new identity.

Constrained, and the constraints bite:

- `docs-paths.test.mjs` validates every backticked source path in those files.
- `docs-drift.mjs` fails a **typed claim** in prose — a hand-written count, port,
  command, env var, transport, ADR reference or coverage floor that disagrees with the
  code. `site-doctor` check 1 exists for the same reason.
- The verify step count is written into prose in two files (`gate-tooling.test.mjs:396-414`).
  Untouched here, because `verify` is untouched.

### Out of scope

**Deploying the site.** `.github/workflows/docs.yml` uploads a Pages artifact and has no
`deploy-pages` step, with `permissions: contents: read`. `CHANGELOG.md:259-264` records
it as a deliberate open item, and `site:doctor`'s own `why` (`gate-tooling.json:255`)
says `pr-reporting` is the honest tier *while the site is not live*. Shipping a
`pages: write` + `id-token: write` surface is a security decision, not a design one.
Record a ledger row; do not do it here.

---

## 9. Ordered tasks

**Phase 1 — product**

1. Add the ledger row recording the supersession of D13 and D16, and amend both plans.
2. Add plane + accent + restated run-state tokens to `theme.css`; update the `blue` ramp.
3. Contrast cases in `theme.test.ts`. Flip the border guard if the border is raised.
4. Commit fonts; `@font-face` with metrics-override fallbacks; preload; confirm the secret
   scanner skips `.woff2`.
5. Glass-ban ESLint block + `no-glass-over-data` review rule.
6. Escape-hatch media queries, one test each.
7. `motion.css` keyframes + `--animate-*`; replace the 13 dead utilities; extend
   `REMOVED_IN_TAILWIND_V4`.
8. Extend `theme-resolution.test.ts` to `apps/web/src`.
9. Stand up `.storybook/main.ts` + `preview.ts`, importing `theme.css`.
10. Fix the eight component defects in §6.
11. `pnpm verify:local`, `pnpm coverage:ratchet`, `pnpm review:rules`.

**Phase 1 — documentation**

12. `site/.vitepress/theme/` — CSS, fonts, `Home.vue`.
13. `site-doctor` check 8 — site tokens conform to `packages/ui`.
14. Section landing pages; admonitions; evidence-chain hero.
15. Restructure `README.md`, `CONTRIBUTING.md`, `AGENTS.md`.
16. `pnpm site:generate && pnpm site:doctor && pnpm docs:check && pnpm docs:dead-exports`.

**Phase 2 — shipped, with one half still open**

18. ~~`pnpm render:baseline` on reference hardware; `recorded: true`; raise `test:render`
    to `pr-blocking` in the same commit.~~ **Reordered, not skipped.** Executed as step
    G-1…G-5 of `.kilo/plans/1791096500000-full-glassmorphism-plan.md`: the glass tokens,
    the radius ceiling and the per-route cap are in, and the route-level axe gate that had
    to precede them is in.
17. `pnpm render:baseline` on reference hardware; `recorded: true`; raise `test:render`
    to `pr-blocking` in the same commit. **Still not done, and now the exit criterion
    rather than the entry one.** Recorded as the open disposition of `GLASS-1`.

> **Status 2026-10-03, superseded 2026-10-04.** Steps 1–16 landed. Steps 17 and 18 did not,
> and the reason is the one this plan spends a section on — D6-9 made `PERF-1` closed the
> **entry** criterion for Phase 2, and `PERF-1` closes on a deliberate human run of
> `render:baseline` on a self-hosted single-node install. The ceilings describe that
> hardware; a run anywhere else calibrates a required gate to a machine nobody else has.
>
> **2026-10-04 — what changed and why the ordering was wrong.** Making a *timing*
> measurement the gate on a *structural* change left two bad options: block forever, or
> ship against nothing. The glass plan splits the two. `glassStackDepth` in
> `performance/rendering-budget.json` is a structural count, not a timing, so it is
> compared in every phase and is green today at a depth of 1 on all four routes. The four
> LCP/INP/CLS/long-task readings still wait for reference hardware, which makes them the
> exit criterion — `GLASS-1` stays open until `pnpm render:baseline` has been run on the
> reference install and `test:render` has been raised to `pr-blocking` **in the same
> commit**.
>
> The gate that holds the remainder shut is still enforced, and was verified in both
> directions on 2026-10-03 against the real files rather than reasoned about:
> `recorded: false` at `pr-blocking` is rejected as *"a required check that can never pass
> blocks every pull request, trains reviewers to ignore red, and hides the failures that
> matter"*, and `recorded: true` left at `pr-reporting` is rejected as *"a gate nobody is
> required to satisfy, which is worse than the two-phase rollout it replaced."*
> `scripts/lib/gate-tooling.test.mjs` asserts the first on every PR, so the blocking is a
> gate rather than a promise.
>
> The dependency is recorded on the row that carries it — `PERF-1.sequencedBehind` and
> `GLASS-1` in `docs/quality/findings-ledger.json` — rather than only here, because a plan
> is a document and a row is something `findings:check` can refuse. `RF-10`'s
> `premiseExpires` field covered the other half of the same story: the cross-engine glass
> risk it refuted became live the day the allowlist opened, which is why that premise's
> remedy was to **widen `PERF-1`** rather than to reopen `RF-10`.

---

## 10. Validation

Every gate in §7, plus:

- **Red-first, per `AGENTS.md` and `.kilo/skills/evidence-test`.** Write each test, run
  it with the defect still present, watch it fail for the expected reason, then fix.
  Three times in this repository's history a suite was fully green while checking the
  wrong thing.
- axe in `packages/ui` (`Accessibility.test.tsx`) stays green in **both** themes.
- `theme-resolution.test.ts:320`'s floor of 40 colour candidates still holds after the
  token rename.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` clean.
- No `.skip` or `.only`. No `any`. Coverage floors move **up** only.

## 11. Risks

| Risk | Handling |
|---|---|
| The glass ships without a measurement | D6-9. No `backdrop-filter` until `PERF-1` closes. Phase 2 is separately gated |
| The new palette fails contrast and gets "fixed" by loosening the assertion | Every threshold is 4.5 or 3 because it is a WCAG requirement. A failure means the token is wrong, not the test |
| The `verify` budget is spent | Not touched. 16 of 20 |
| Storybook visual regression compares unstyled markup because `preview.ts` does not import `theme.css` | Step 9 imports it, in the same commit that creates the file |
| A second design authority reappears | One place: `theme.css`. The site imports it; nothing restates it. The supersession is recorded in the ledger and in both superseded plans |
| The redesign is read as churn | Each §6 item is a named defect with a file and a line, not a taste change |

## 12. Open questions

None blocking. Both were recorded rather than asked, and both now have a row:

- **The site is still not deployed** (§8). Recorded as `SITE-1` in the ledger, as
  `debt` with an owner and a removal condition, because shipping it means granting
  `pages: write` and `id-token: write` and that is a security decision rather than a
  design one. `status-ten.mjs` had already declared `deferral: 'SITE-1'` for point 12
  and the lookup had been missing — so the deferral is now real rather than nominal.
- **`PERF-1` and `RF-9` still need one visit to reference hardware.** Until then Phase 2
  cannot start, and this plan is honest about that rather than pretending otherwise. The
  sequence is recorded on `PERF-1.sequencedBehind`, the gate that enforces it is
  `scripts/lib/gate-tooling.test.mjs` asserting `render-gate-phase.mjs` in both
  directions, and `RF-10`'s `premiseExpires` field records the date its own refutation
  stops holding.

Nothing in this plan is outstanding. Two of its outcomes are owned by other rows, and
that is where the reader goes next, not back here.