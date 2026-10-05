# Full glassmorphism

**Status:** plan of record. **Supersedes D6-6** in
`1791024280658-cinematic-design-language-and-docs-overhaul.md` ("Glass is chrome, never data"), and
executes that plan's Phase 2 steps 17–18 **ahead of** `PERF-1`, recording the gap rather than
pretending it is closed.

**Two decisions, taken deliberately:**

| # | Decision | Supersedes | Consequence recorded |
| --- | --- | --- | --- |
| **G-1** | Glass is permitted **over data**, not only over chrome | D6-6 | `no-glass-over-data` can no longer be a rule that fires; a fifth plane step is refused (§2); a readability mechanism is required (§3) |
| **G-2** | The allowlist opens with the rendering budget **uncalibrated** | cinematic-plan step 17's ordering | `PERF-1` is widened, not worked around. `test:render` stays `pr-reporting`, measures, and compares nothing |

---

## 0. The premise expired yesterday, and the repo already said what to do

`RF-10` is a `false-positive` row whose refutation carries an explicit expiry. Verbatim:

> **The refutation rests on a premise with an expiry date, 2026-10-03.** […] The moment Phase 2
> opens the allowlist, the property this row refuted exists, and the refutation needs re-reading
> rather than re-running.
>
> The disposition when that happens is already recorded. […] the right move on the day Phase 2 lands
> is not to reopen `RF-10` (`false-positive` is terminal, and `isForward` in
> `scripts/lib/findings-ledger.mjs` does not allow it) and not to add a ninth row: it is to **widen
> `PERF-1`'s summary to name the cross-engine glass case explicitly**, so one row carries the
> measurement gap rather than two rows carrying halves of it.

Today is 2026-10-04. **So this plan does exactly what the row instructs and nothing else: it widens
`PERF-1`.** It does not reopen `RF-10`, and it does not add a row for the cross-engine risk.

That row also hands over the effect values the cinematic plan had scheduled — **blur 8–16px,
saturation 1.05–1.15** — and names the signature it had refuted (`blur(20px) saturate(180%)`). Those
numbers are the starting point, and §2 explains why the top of each range is where this plan lands.

---

## 1. The four gates that change, precisely

### 1.1 `eslint.config.js` — four blocks, two selectors

Not one rule. `GLASS_SELECTOR` (class strings) and `GLASS_PROPERTY_SELECTOR` (inline
`backdropFilter`) are spread into **every** block that sets `no-restricted-syntax`:

| Block | Line | Why it is there |
| --- | --- | --- |
| `**/*.{ts,tsx}` | `:303` | the app itself |
| `packages/db/src/schema/**`, `packages/shared-contracts/src/**` | `:331` | un-banning there would be a hole in the contract trees |
| `**/*.{test,spec}.{js,mjs,ts,tsx}` | `:353` | *deliberately*, so the class cannot be written even in a test — "the one place it would matter most to forbid writing it at all" |

The header comment names the failure this shape exists to prevent: *"a standalone block silently
replaced the double-assertion rule the first time it was written."* So the allowlist is **one exported
constant** and every block reads it, rather than three edits that can drift.

### 1.2 `.github/review-rules/rules.json` — `no-glass-over-data`

`Major`, category *Boundary design*, and its `pathGlobs` name the evidence components directly:
`packages/ui/src/components/Table/**`, `StatCard/**`, `CommandPalette/**`, `apps/web/src/**`,
`packages/ui/src/**`, plus `run-detail.tsx`, `quarantine.tsx`, `gaps.tsx`, `RunList.tsx`,
`RunExplorer.tsx`.

**Under G-1 this rule fires on essentially every component glass touches.** A review rule that always
fires is the `SEM-2` shape — 543 permanently-red semgrep findings are what taught this repository
that a red gate stops catching regressions. So it is **replaced, not deleted**; §4 says what replaces
it and why deleting it would throw away the only written record of the concern.

Its rationale is also the sentence this plan has to answer rather than erase:

> *The pixels behind a panel in this product are usually the evidence itself — a run log, a stack
> trace, a table of digests — so a lens over them makes legibility a function of what happens to be
> underneath, and two readers can see the same line differently.*

§3 is the answer. It is a mechanism, not a reassurance.

### 1.3 `PERF-1` — widened, in one commit, with the code

`scripts/lib/render-gate-phase.mjs` computes the permitted tier from
`performance/rendering-budget.json`, and `gate-tooling.test.mjs` fails if `scripts/gate-tooling.json`
disagrees, **in both directions**. Under G-2 the baseline stays `recorded: false` and `test:render`
stays `pr-reporting` — the state the gate was built to permit — and `PERF-1`'s summary is widened to
name two things it did not before:

1. the cross-engine glass case (`RF-10`'s instruction), and
2. that **blur is live while the budget compares nothing**, which is a materially worse position
   than the one `PERF-1` was written to describe.

Widening and shipping in one commit is the point. A row that learns about the risk after the code
lands is a row describing history.

### 1.4 The design language's own rule — and why G-1 does not add a fifth surface

`site/guide/design-language.md:39`:

> There is no fifth surface. A component that needs one is a component that needs a token, a
> contrast case and a name for what the new step is.

Glass over data looks like it demands a fifth step. **It does not, and taking the cheaper answer is
the point:** a glass panel is not a new plane, it is *the existing plane with an alpha channel*, and
the plane's four steps keep their contrast tests. A fifth step would put every existing token on a
new footing to accommodate an effect that is a property of the fill, not of the height. §2 is the
alpha dimension; §3 is the contrast case that has to move.

---

## 2. Tokens: an alpha dimension, blur at the bottom of the range

In `packages/ui/src/tokens/theme.css`, beside the four plane steps:

```
--automate-glass-blur: 8px          /* the floor of the scheduled 8–16px range */
--automate-glass-saturate: 1.05     /* the floor of the scheduled 1.05–1.15 range */
--automate-glass-fill: color-mix(in oklab, var(--automate-surface) 72%, transparent)
--automate-glass-border: …          /* see §3 — a fixed alpha border cannot exist */
--automate-glass-radius: 12px       /* ceiling, not a default */
```

**Why the bottom of both ranges, when the plan scheduled 8–16 and 1.05–1.15.** Because the whole
argument against glass is cost and legibility, and both scale with the radius of the kernel and the
strength of the saturation. 8px and 1.05 deliver the material read — you can see there is something
behind the panel — at roughly a third of the compositing cost of 16px and 1.15. The upper half of
the range is available as a token later, on a measurement, which is the only reason it should ever
be reached.

`--automate-glass-radius` is a **ceiling** because a radius that grows past the panel's content
starts rounding the data inside it, and rounded evidence columns are harder to compare down a column.

**A fixed alpha border cannot exist, and that is the §3 crux.** The design language has two borders,
both measured, precisely so 1.4.11 is not applied to every border
(`design-language.md:108`). A glass border's whole job is to describe the panel's edge against
whatever is behind it — so it is not one colour, it is a *function of the backdrop*, and a token
cannot hold it. A `1px` hairline at a fixed alpha is invisible on a light backdrop and a hard line on
a dark one.

So the border is declared as **elevation**, not as a colour: glass panels take a stronger elevation
shadow and no border token, and the edge is described by the shadow's own contrast against the
sampled backdrop. This is a real change to the two-border rule and it is written into the design
language page, not left as a component's private choice.

---

## 3. Answering the readability concern with a mechanism

The concern is legitimate and G-1 does not dismiss it. Four mechanisms, each machine-checked, each
failing in a way a test can see:

1. **`prefers-reduced-transparency` gets an opaque fallback.** Someone who has told the OS they do
   not want translucency gets `--automate-surface` and the elevation shadow. The cinematic plan
   already listed this as a gate; it is load-bearing under G-1 and not optional.
2. **A minimum-opacity floor.** `--automate-glass-fill` at 72% is the *lightest* a data panel may go.
   Below it, contrast against the worst-case backdrop stops being measurable, so the floor is a
   token value with a test, not a guideline.
3. **The contrast test moves from "token vs plane" to "token vs worst-case backdrop."** The design
   language states there is *a test for that case per plane step*. Under glass, the backdrop is not
   known, so the test computes against the extreme of the plane behind it and requires the ratio to
   hold at **both** extremes. A panel that passes only against `--automate-surface` and fails against
   `--automate-surface-sunken` is the exact defect this catches, and no existing assertion can see
   it.
4. **The axe spec lands first.** `pnpm status:10` reports **13 route files, zero covered**, and
   `expectNoBlockingAxeViolations` is used by exactly one component test. Shipping glass over data
   with no route-level axe run means shipping an untested legibility change. **G1 is a wave, not a
   step inside another wave**, because everything after it is unmeasured otherwise.

---

## 4. What replaces `no-glass-over-data`

Not deletion. A rule that asks the question glass actually raises, which is *not* "is there glass":

> **`glass-over-unstable-backdrop`** — a translucent fill whose backdrop moves. A panel over a static
> plane samples a fixed set of pixels and its contrast is a property of the theme. A panel over a
> scrolling log, a streaming progress bar, a `LIVE` pulse or an animating surface samples pixels
> that change under the text, so the same line is legible at one scroll position and not the next —
> which is the *"two readers can see the same line differently"* failure, stated as the mechanism it
> actually is.

`pathGlobs` inverts: the named evidence components stay in scope, but the question changes from
"is this translucent" to "is what is behind this translucent *moving*". That keeps the rule firing on
real cases, so it stays a gate rather than becoming noise.

The rationale text is **carried forward verbatim** into the new rule with the decision recorded above
it. The concern was correct; the conclusion drawn from it is what G-1 overturns, and a reader six
months from now should be able to see both.

---

## 5. The waves

### G0 — Record the decision, in the same commit as the code it describes

- `docs/quality/findings-ledger.json` — **new row `GLASS-1`**, `Major`, recording the supersession of
  D6-6, G-1, G-2, and the widened `PERF-1`. Precedent: the cinematic plan's own step 1 recorded the
  supersession of D13 and D16 the same way.
- **`PERF-1`'s summary widened** by `RF-10`'s own instruction — cross-engine glass named explicitly,
  and the "blur is live while this compares nothing" fact added. **No new row for it.**
- `1791024280658-cinematic-design-language-and-docs-overhaul.md` — D6-6 struck, steps 17–18 marked
  executed-with-gate-open, and the status note under §9 amended.
- `1791093678000-autonomous-qa-cockpit-plan.md` §3.6 — its argument that the visual target is the
  design language *rather than* glass is now **wrong** and is corrected in place, because the cockpit
  is the screen glass lands on first.
- `site/guide/design-language.md` — the Glass section rewritten; the two-border rule gains the
  elevation-not-alpha case; the alpha dimension and its floor documented with the measured values.

**Gate:** `pnpm findings:check`, `pnpm docs:check`.

### G1 — The axe spec, before any glass

`e2e/accessibility/routes.spec.ts`, 13 routes, **both themes**, axe zero serious and zero critical,
plus a state matrix for loading/empty/error/partial. It is generated from the routes it visits, not
hand-maintained. This also discharges `W11.4` conditions (a) and (b).

**Gate:** `pnpm status:10` point 4 flips `fail` → `pass`.

### G2 — Tokens, alpha, and the contrast cases

- `theme.css` — the §2 tokens.
- `theme.test.ts` — the §3.3 worst-case-backdrop assertion, per plane step, both themes.
- `theme-resolution.test.ts` — extended to cover the new utilities the way it already covers both
  trees, and a new list asserting **no `backdrop-*` class exists that no component declares**, so a
  blur radius cannot be invented per component.

**Gate:** `pnpm --filter @automate/ui test`, token-resolution green in both themes.

### G3 — Open the lint, replace the review rule

- `eslint.config.js` — one exported `GLASS_ALLOWLIST`, read by all four blocks. Not three edits.
- `rules.json` — `no-glass-over-data` replaced by `glass-over-unstable-backdrop` (§4). Both stay in
  the ruleset vocabulary, so `scripts/review/ruleset.mjs` and the seven mapped personas still agree —
  that mapping is asserted in both directions.

**Gate:** `pnpm review:rules`, `pnpm lint`.

### G4 — Adoption, and the per-route blur cap

Components adopt `--automate-glass-*` starting with `AppShell`, `NavBar`, `Card`, `Drawer`, `Popover`,
`CommandPalette`, `Toast` — then `Table` and `StatCard`, which is where G-1 actually bites. The
per-route blur cap is a value in the rendering budget's route list, so a route cannot silently raise
its own.

**Gate:** axe in both themes across all 13 routes; the cockpit's `unmeasured` cell and the queue rows
read at the floor opacity in a screenshot reviewed as a diff.

### G5 — The fallback, and the baseline when hardware exists

`prefers-reduced-transparency` wired and tested. `pnpm render:baseline` on a self-hosted single-node
install, `recorded: true`, `test:render` raised to `pr-blocking` **in the same commit** — which
`render-gate-phase.mjs` and `gate-tooling.test.mjs` already enforce in both directions, so graduating
cannot be half-applied.

---

## 6. Ledger

**One new row.** `GLASS-1`, Major — G-1 supersedes D6-6; G-2 opens the allowlist with the rendering
budget uncalibrated; `PERF-1` widened rather than duplicated.

**No row for the cross-engine risk.** `RF-10` says so in its own `premiseExpires`, and `false-positive`
is terminal.

**No row for the uncalibrated gate.** It is `PERF-1`, widened — which is what `PERF-1` is for.

---

## 7. Risks

| Risk | Handling |
| --- | --- |
| **A QA number is now read through a lens.** `Table/**` and `StatCard/**` are the two components a verdict arrives in, and G-1 puts glass on both | §3's four mechanisms, and the floor at 72% is a token with a test rather than a guideline |
| **No calibrated rendering gate while blur is live.** The one gate that would catch a blur regression compares nothing | G-2 records it rather than hiding it; G5 is the exit and the gate already refuses to be half-applied |
| **WebKit is the engine with the longest `backdrop-filter` history, and the suite is Chromium-only** | `RF-10`'s surviving gap, carried on `PERF-1` by its own instruction. A three-project matrix is `playwright.config.ts` work and is named here rather than assumed done |
| **The alpha border cannot be a token** | §2: elevation describes the edge, the two-border rule gains the case, the design language page records it |
| **A permanently-red review rule** | §4 replaces rather than deletes; `SEM-2` is the precedent for what happens otherwise |
| **`apps/web` coverage is at 96/88/96/98** | G1 and G4 are the two waves touching many web files, and the floor does not move to accommodate them |

---

## 8. What this plan does not do

- **It does not open the upper half of the blur range.** 8px / 1.05 is the whole effect; 16px / 1.15
  waits on a measurement, which is the only reason it should ever be reached.
- **It does not retire `no-glass-over-data`'s reasoning.** It replaces the rule and carries the
  rationale forward, because the concern was correct and only its conclusion is overturned.
- **It does not reopen `RF-10`.** The row forbids it and pre-recorded what to do instead.
- **It does not make the rendering gate pass.** It makes the absence visible in the row that already
  exists for it, and leaves the graduation to G5 on hardware this host is not.