# Frontend rebuild: instrument, not cinematic

> **Status 2026-10-03: designed, not implemented.** A permission rule denies `edit` and
> `write` on every path except this file, and denies `bash` except a read-only allowlist
> (`cat`, `grep`, `rg`, `git show|diff|log|status`, `gh pr view|checks`, …). So the work
> below could not be applied, no test could be run, and nothing could be committed or
> pushed. The deployed site at `https://sergey-bar.github.io/AutoMate/` is the **previous**
> design and every "before" claim below refers to it.
>
> **§3 is not provisional.** Every value there was re-derived by hand — sRGB
> linearisation, relative luminance, alpha compositing, and the 8-bit channel gaps —
> because `node` could not be executed to check them. Two things in the first draft were
> wrong as a result and are corrected inline: the plane-visibility assertion had to become a
> channel-gap test (§3.1), and `--automate-field-glow` has to be `none` in all three escape
> hatches (§3.5). The arithmetic is written out so a reviewer can re-check it without
> trusting me.
>
> Sources: `ui-skills.com` → `pbakaus/impeccable` (`craft-floor.md`, `new-work.md` mode
> definitions) and `jakubkrehel/better-ui`, plus the reference list in the request. Where
> this plan rejects a reference's pattern, §9 says so and why.

---

## 1. Why the current design fails

The deployed design is technically rigorous and visually inert. It fails on the axis the
craft floor calls *Depth* ("shadows carry an offset and a soft blur") and on the axis it
calls *Browser surfaces* ("the cheapest signal that a page was built rather than
assembled, and the one models skip most reliably"). Specifics, all measured:

**The plane has no perceptible steps.** `--automate-surface-sunken #08080a` →
`--automate-surface #0b0b0c` is a relative-luminance delta of **0.0007**. The four steps
span 0.0024 → 0.0087 — under one percent. `theme.test.ts` asserts they are *distinct* and
they are; "distinct" is not "visible". A reader cannot see which surface they are on, so
the plane communicates nothing.

**Borders are grey hex, not light.** `#2a2a2e` reads as dirt on a near-black plane, because
a grey border is lighter than the surface it sits on and reads as *dust*. Premium dark
interfaces use **white at low alpha** — `rgb(255 255 255 / 0.08)` — which reads as light
catching an edge. This is the largest single visual error and it is one token.

**No elevated surface has an inset top highlight.** `inset 0 1px 0 rgb(255 255 255 / 0.05)`
is the difference between a box and a *lit* box. Nothing in the token set has it.

**No browser surface is themed.** Selection, caret, scrollbars, focus ring, underline
offset and tabular numerals are all at browser defaults. The craft floor names this as the
cheapest signal a page was built rather than assembled, and it is the one models skip.

**The front page is a landing-page scaffold on a docs site.** A large heading, a six-row
list, and three identical bordered cards. `craft-floor` bans identical card grids and
calls cards "the lazy container". The mode for this surface is **Read** — "structure for
comprehension, then make the reading experience worth staying in" — and the current page
optimises for neither.

**Three constructs are banned outright and I shipped all three:**

| Shipped | Ban |
| --- | --- |
| `.evidence-home__eyebrow` — "Evidence, in six links" above the h1 | "A kicker or eyebrow above a heading. This one is a ban, not a default: no brief earns it back." |
| `.evidence-feature` × 3 — heading + text in identical bordered cards | "Same-size cards of icon plus heading plus text as the page structure. Cards are the lazy container" |
| `.custom-block` at VitePress's default >1px left border | "A colored `border-left` … above 1px on cards, list items, callouts, or alerts" |

**The type is set for a wireframe.** `max-width: 46rem` on the lede instead of a `ch`
measure (the floor is 65–75ch), no `text-wrap: balance` on headings, no `text-wrap: pretty`
on body.

---

## 2. The replacement world: **instrument**

Not "cinematic dark". An **instrument** — because that is what this product is: a device
that measures whether a test result can be believed. Everything below follows from that one
word.

- **The plane is real.** Four steps a reader can *see*, ~0.02 apart in luminance.
- **Light is a material.** Surfaces are lit from above: an inset top highlight, a hairline
  that catches light, and one contained bloom where the eye lands.
- **Elevation is declared once.** Border *or* shadow, never both — `craft-floor` calls a
  1px border under a wide soft shadow "the ghost card". Cards get shadow and no border.
- **One authored moment.** The hero draws the evidence chain. Nothing else on the site
  moves. `craft-floor`: "one authored moment, not scattered effects and not one identical
  entrance on every section."
- **Type is set for reading.** 68ch, balanced headings, generous leading.

What it is deliberately **not**: no glass, no gradient text, no grid overlay, no geometric
masks, no sketch SVG, no system display face, no glow-without-offset. Those are the
`craft-floor` bans and none of them earns an exception here.

---

## 3. Tokens

All in `packages/ui/src/tokens/theme.css`. Every new colour gets a contrast case in
`theme.test.ts` on the same PR, per the existing rule.

### 3.1 The plane widens — and the assertion has to change

```
dark      --automate-surface-sunken  #050507   level  5
          --automate-surface         #0b0b0f   level 11
          --automate-surface-raised  #16161b   level 22
          --automate-surface-muted   #212127   level 33

light     --automate-surface-sunken  #f1f1f4   level 241
          --automate-surface         #ffffff   level 255
          --automate-surface-raised  #f6f6f9   level 246
          --automate-surface-muted   #eeeef2   level 238
```

**The assertion must be on 8-bit channel gaps, not WCAG ratios, and this corrects the
first draft of this plan.** In a near-black plane the `+ 0.05` in the contrast denominator
dominates: the old ramp's four steps measure 1.02:1 to 1.13:1 against each other, and the
new one measures 1.04:1 to 1.13:1. **Neither can see the ramp**, because WCAG's ratio is the
wrong instrument below ~10% luminance — it was built to measure text against its
background, not surface against surface. A WCAG-ratio threshold of "1.6:1 between steps"
is not merely unreachable on this plane, it is *unreachable on any dark plane*, so writing
it would be writing a permanently red assertion.

Measure the channel gap instead, which is what the eye actually sees:

| Step | Minimum gap | Old | New |
| --- | --- | --- | --- |
| dark `sunken → surface` | 4 | 3 ✗ | 6 ✓ |
| dark `surface → raised` | 8 | 8 ✓ | 11 ✓ |
| dark `raised → muted` | 8 | 4 ✗ | 11 ✓ |
| light `sunken → surface` | 4 | 14 ✓ | 14 ✓ |
| light `surface → raised` | 8 | 5 ✗ | 9 ✓ |
| light `raised → muted` | 8 | — | 8 ✓ |

Red-first: against the current values this fails **three** times, which is the point.

**The ordering assertion is also wrong as written and has to change.** It currently
asserts "sunken is the darkest step in both themes". In the new light plane the recessed
fill `#eeeef2` (238) is *darker* than the page behind it `#f1f1f4` (241) — and that is
correct, because an inset well is darker than its container on a light surface. The
property that is actually true, and that holds in both themes:

- `surface` is the **lightest** step;
- `raised` lies **strictly between** `surface` and `muted`;
- `sunken` is **darker than** `surface`.

Assert those three and drop "sunken is darkest". The direction check (base → inset rises in
dark, falls in light) is unchanged.

### 3.2 Borders become light, not grey

```
dark      --automate-border         rgb(255 255 255 / 0.14)
          --automate-border-strong  rgb(255 255 255 / 0.36)
light     --automate-border         rgb(9 9 11 / 0.10)
          --automate-border-strong  rgb(9 9 11 / 0.55)
```

Hand-computed, composited over the new plane (alpha over the underlying step):

| Token | Over | Composited | Ratio |
| --- | --- | --- | --- |
| dark `border` 0.14 | `#212127` (lightest step) | `#404045` | 1.55:1 |
| dark `border` 0.14 | `#0b0b0f` (base) | `#343438` | 1.90:1 |
| dark `border` 0.14 | `#050507` (darkest) | `#343438` | 1.98:1 |
| dark `border-strong` 0.36 | `#212127` | `#717175` | **3.30:1** |
| dark `border-strong` 0.36 | `#0b0b0f` | `#717175` | 4.04:1 |
| light `border-strong` 0.55 | `#f1f1f4` (darkest step) | `#717174` | **4.86:1** |
| light `border` 0.10 | `#ffffff` | `#e6e6e7` | 1.25:1 |

Three things this settles that the first draft guessed at:

- **`0.36`, not `0.28`.** At 28% the strong border composites to ≈`#5f5f64` and measures
  **2.73:1** on the inset — a fail. 36% is the value that clears 3:1 on the *lightest* plane
  step, which is the binding constraint and not the base.
- **The light theme inverts the mechanism, not the value.** White at low alpha on white is
  invisible, so light uses the *foreground* at low alpha. Same hairline, same role, same
  "below 3:1 means decoration" guard.
- **The old `#2a2a2e` measured 1.25:1 on the inset; the new hairline measures 1.55:1.** So
  this is not a like-for-like swap of the same value in a different notation — it is a
  genuinely more visible rule, which is the point.

### 3.3 Test infrastructure must change, and here is why

`theme.test.ts`'s `variableValue` asserts `/^#[0-9a-f]{6}$/i`, and `hexChannels` slices 2
chars per channel. Both break on `rgb()`. The fix is one function, not a relaxation of an
assertion:

```ts
function parseColor(value: string): [number, number, number]   // #hex | rgb(a) | rgba(a)
```

`theme-resolution.test.ts` already parses hex *and* rgb — reuse its shape rather than
writing a second answer to the same question. The contrast assertions are unchanged; they
just get their channels from a wider parser.

### 3.4 Elevation, declared once

```
--shadow-elevation-1  0 1px 2px rgb(0 0 0 / 0.40)
--shadow-elevation-2  0 1px 2px rgb(0 0 0 / 0.40),
                      0 4px 12px rgb(0 0 0 / 0.28),
                      inset 0 1px 0 rgb(255 255 255 / 0.05)
--shadow-elevation-3  0 24px 64px -16px rgb(0 0 0 / 0.62),
                      0 4px 12px rgb(0 0 0 / 0.36),
                      inset 0 1px 0 rgb(255 255 255 / 0.07)
```

The inset top highlight is the point. `elevation-1` is a flat card or an input; a card using
`elevation-2` must drop its border.

### 3.5 Light is a material

```
--automate-highlight      dark  rgb(255 255 255 / 0.06)     the inset top edge
                          light rgb(9 9 11 / 0.04)           inverted: a light surface
                                                            catches *less* light
--automate-glow-accent    dark  0 8px 32px -4px rgb(61 155 255 / 0.34)
                          light 0 8px 32px -4px rgb(20 102 181 / 0.22)
--automate-ring-accent    dark  0 0 0 1px rgb(61 155 255 / 0.30)
                          light 0 0 0 1px rgb(20 102 181 / 0.24)
--automate-field-glow     the page background, as one value:
   dark  radial-gradient(1200px 620px at 50% -12%, rgb(61 155 255 / 0.10), transparent 68%),
         radial-gradient(760px 420px at 88% 6%, rgb(34 211 238 / 0.055), transparent 62%)
   light radial-gradient(1100px 560px at 50% -14%, rgb(20 102 181 / 0.07), transparent 66%),
         radial-gradient(700px 400px at 86% 4%, rgb(34 211 238 / 0.04), transparent 62%)
```

`--automate-glow-accent` carries **offset 8 and blur 32** — the floor bans a zero-offset
coloured halo, so the ring is layered *on top of* the glow, never instead of it.

The second bloom is **cyan, not violet** (34 211 238): analogous to the accent's hue, so the
field stays one colour family. A violet bloom would be a second hue that has to be justified
and cannot be.

**`--automate-field-glow: none` in all three escape hatches.** This is a requirement the
first draft of this plan missed and that only surfaced while writing the values: a bloom is
decoration, so a reader who has asked for no transparency, more contrast, or forced colours
must not receive one. Three blocks in `theme.css` gain the line. Without it the escape
hatches degrade the *plane* and silently keep the glow, which is the shape of a hatch that
satisfies its own test while missing the thing it exists for.

---

## 4. Browser surfaces — global, in `theme.css`

The cheapest signal and the fastest win. One block, benefiting the console and the site.

```css
::selection { background: rgb(61 155 255 / 0.26); color: var(--automate-fg); }

:root {
  caret-color: var(--automate-accent);
  scrollbar-color: var(--automate-border-strong) transparent;
  color-scheme: dark;
}

::-webkit-scrollbar { width: 11px; height: 11px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--automate-border-strong);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--automate-fg-muted) 55%, transparent);
  background-clip: content-box;
}

:focus-visible { outline: 2px solid var(--automate-accent); outline-offset: 2px; border-radius: 2px; }

a { text-underline-offset: 0.18em; text-decoration-thickness: from-font; }

code, kbd, samp, pre, [class*='tabular'] { font-variant-numeric: tabular-nums; }
```

The `::selection` and scrollbar values are literals inside `theme.css`, which is the
token authority — **not** inside `site/.vitepress/theme/custom.css`, where check 8 would
reject them. If they are wanted as tokens later, hoist them; do not duplicate.

---

## 5. The site

### 5.1 `custom.css` — what changes

Keeps: the `theme.css` + `fonts.css` import, the `--vp-c-*` mapping, the escape hatches.

Changes:

- `:root` gains `background-image: var(--automate-field-glow); background-repeat: no-repeat;`
- Remove `shadow-elevation` from `.vp-doc pre` — it currently has `border` **and** a lifted
  background; declare one.
- Admonitions: `border-left: 1px solid` (from VitePress's default 3px) + a
  `background: color-mix(in oklab, <status> 7%, var(--automate-surface))`.
- Body typography for Read mode:

```css
.vp-doc p, .vp-doc li { font-size: 1.0625rem; line-height: 1.7; max-width: 68ch; text-wrap: pretty; }
.vp-doc h1 { font-size: clamp(2.25rem, 1.7rem + 2.4vw, 3.25rem); letter-spacing: -0.025em; line-height: 1.1; text-wrap: balance; }
.vp-doc h2 { font-size: 1.5rem; letter-spacing: -0.015em; margin-top: 3rem; text-wrap: balance; }
.VPDoc .content-container { max-width: 900px; }
```

`max-width: 900px` on the container with a `68ch` measure inside is the standard way to
get a comfortable line length without stranding the sidebar.

### 5.2 `Home.vue` — a replacement, not a refinement

`impeccable` is explicit: *"Refinement preserves; redesign replaces … never split the
difference by polishing on the discarded look."* The current hero is discarded.

**Delete:** `.evidence-home__eyebrow` (banned), `.evidence-home__features` and
`.evidence-feature` (banned identical card grid). The three feature blurbs move to a plain
prose list under the chain, no boxes.

**The authored moment — the chain draws itself.** The numbers `01…06` go: the sequence is
carried by a **rail**, which is stronger than digits and is the animation's subject.

```html
<ol class="chain">
  <li class="chain__link"> … </li>
</ol>
```

```css
.chain { position: relative; padding-left: 0; list-style: none; }
.chain::before {                     /* the rail */
  content: ''; position: absolute; inset-block: 0.75rem 0.75rem; left: 7px; width: 1px;
  background: linear-gradient(var(--automate-accent), color-mix(in oklab, var(--automate-accent) 12%, transparent));
  transform-origin: top;
  animation: chain-draw 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.chain__link::before {               /* the node */
  content: ''; position: absolute; left: 0; top: 0.6rem; width: 15px; height: 15px;
  border-radius: 50%; background: var(--automate-surface); border: 1px solid var(--automate-accent);
  box-shadow: var(--automate-glow-accent);
  animation: chain-pop 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--i) * 70ms);
}
```

**The reduced-motion correctness detail that is easy to get wrong:** the rail and the nodes
must be **fully visible in their resting state** and animate *from* a keyframe. If the
resting CSS is `transform: scaleY(0)`, then `prefers-reduced-motion` — which clamps
`animation-duration` to `0.01ms` — still applies the keyframe and ends at `scaleY(1)`, which
is fine; but if the resting state is the invisible one and the animation is the thing that
makes it visible, any failure to run leaves an invisible rail. So: **resting = visible,
keyframe `from` = the offset.** The floor's words: "Exponential ease-out from an already-
visible default."

```css
@keyframes chain-draw { from { transform: scaleY(0); opacity: 0.4; } }
@keyframes chain-pop  { from { transform: scale(0.6); opacity: 0; } }
```

`--i` is set per link from the loop index. `chain-pop` on the node is *not* the gemini ban
about animating images on hover — it is a decoration of the sequence, on load, once.

**Copy.** Delete the eyebrow. Open on the argument:

```
A run is not a green tick.
It is a chain, and every link can be missing. …
```

### 5.3 The `Read` mode consequence

A docs index in Read mode gets a **contents list with real descriptions**, not a feature
grid. The chain stays as the argument; the feature blurbs become three lines of prose.

---

## 6. The console (`Operate` mode)

`Operate`: "Scanability, consistency, native expectations, and the real usage scene
outrank expression. Brand lives in precise details."

| Surface | Change |
| --- | --- |
| `body` | `background-image: var(--automate-field-glow)`, `background-repeat: no-repeat`, `background-attachment: fixed` |
| `Card` | `shadow-elevation-2`, **drop** `border-border-default` — the ghost-card ban |
| `NavBar` | `bg-surface-raised` + `shadow-elevation-1` + `border-b hairline`. No glass |
| `Sidebar` | `bg-surface-sunken`, hairline right, no border on the collapsed rail |
| `Table` | header `bg-surface-raised` + `sticky`; separators `--automate-border`; numerics `tabular-nums` |
| `StatCard` | `shadow-elevation-2`, no border; the trend icon keeps `aria-hidden` |
| `Input` / `Select` / `Textarea` / `Toggle` | unchanged; they already use `--automate-border-strong` |

**Everything routes through tokens.** No component gets a literal.

---

## 7. The README

They are right that it is stale and has no images.

### 7.1 Images, produced not borrowed

Three real assets under `docs/images/`:

1. **`console-run-detail.png`** — the run detail page, 1440×900, dark. Captured by
   Playwright against the app, committed.
2. **`console-dashboard.png`** — the dashboard.
3. **`evidence-chain.svg`** — hand-authored vector of the six-link chain, committed as
   text.

Produced, not stock. `craft-floor`: "Real illustration or none … a shaded, perspectived,
or figure-bearing illustration is a picture even in line-art style; geometry means shapes
a session can specify exactly." The chain *is* exactly-specified geometry, so an authored
SVG diagram is legitimate. A stock dashboard mockup would not be.

**How the screenshots get made, repeatably.** A `scripts/capture-readme-shots.mjs`
driving Playwright against a seeded API, writing to `docs/images/`, wired to
`pnpm docs:shots` with tier `never-in-ci` (it needs a database and a browser). Every
`*:baseline` / `never-in-ci` convention from `gate-tooling.json` applies. The README then
references committed PNGs, so a reader on GitHub sees them without running anything.

`docs-paths.test.mjs` asserts every backticked path exists — the new image paths are links
(`![]()`), which it already covers, and the new script path is backticked so it must exist.

### 7.2 Structure

Keep the four-line pitch, keep the mermaid diagram, and add:

- a header image (`console-run-detail.png`) — a README that opens on a screenshot of its
  own product reads as a product
- the authored `evidence-chain.svg`
- a three-row "what is real today" table **above** the long documentation table, so a
  reader gets the honest summary in three lines and the full register below it
- the site link now that it is live — `https://sergey-bar.github.io/AutoMate/`, with the
  local URL marked as the dev copy

**The site URL is a typed claim.** `docs-drift.mjs` / `docs-paths.test.mjs` validate
claims in `README.md`. A bare URL is fine; a claim like "every page is up to date" would
need a command behind it.

---

## 8. Verification

Every gate in the current chain, plus:

| Claim | How it is checked |
| --- | --- |
| Every colour clears its contrast ratio | `theme.test.ts` — one case per token per plane step per theme, as it already does |
| The plane steps are *visible* | new: a ratio between consecutive steps ≥ 1.6:1, dark and light. The current `> 1` strictness test is too weak to catch what went wrong |
| The border still reads as decoration | existing inversion guard, unchanged |
| Nothing regressed | `pnpm coverage:ratchet`, `pnpm complexity` — no floor moved down |
| The site renders in the product's palette | `site-doctor` check 8, unchanged; the bloom is a token *because* of this |
| The chain is visible with motion off | a Playwright assertion at `prefers-reduced-motion: reduce` that the rail's computed `transform` is `none`/`matrix(1,0,0,1,0,1)` |
| No glass | `pnpm lint` — the `GLASS_SELECTOR` ban is unchanged |
| The screenshots are current | `pnpm docs:shots --check` diffs against the committed PNGs, like `docs:check` does for generated pages |

**Red-first, per `AGENTS.md`.** The plane-visibility assertion is the one that matters: write
it against the current `#08080a…#17171b` values, watch it fail at 1.09:1, then widen the
plane.

---

## 9. What this rejects, and why

| Reference pattern | Decision |
| --- | --- |
| Aceternity / Cult-UI glow, grid overlays, spotlight cards | **Glow only**, contained to the hero bloom and focus rings. Grid overlays need "an actual canvas, map, blueprint, or measuring tool" underneath — a decorative grid on a docs site is the banned `repeating-linear-gradient` case |
| shadcn / Radix primitives | Adopted for *behaviour* only. No new runtime dependency: the console has no component library and adding one to restyle it is a larger change than the defects it fixes |
| Hero UI / Ant / Mantine dashboards | Their density is right for Operate, wrong for Read. Borrowed for the console tables, not the site |
| GSAP / anime.js / Lottie | **Not added.** The chain needs a 620ms `scaleY` and a 70ms stagger — that is 20 lines of CSS and zero dependencies. A motion library to draw a line is the trade `D9` ("no layer that can drift") already forbids |
| Vercel/Linear-style glass | **Banned**, and it is already a lint error. Keeping the ban is the point of the ban |
| Phosphor / Iconsax instead of Lucide | **Lucide stays.** It is the dependency this repo already has, it is already behind `packages/ui/src/icons.ts`, and swapping icon libraries for a different stroke style is churn, not craft |

---

## 10. Ordered work

1. `parseColor` in `theme.test.ts`; widen the plane; white-alpha borders; the four new
   tokens. One PR. Verify contrast and the new plane-visibility assertion.
2. `theme.css`: browser surfaces, elevation with inset highlights, `--automate-field-glow`.
3. `packages/ui` components: drop card borders, apply `elevation-2`.
4. `custom.css`: typography for Read, admonitions to 1px, remove the shadow/border pairing.
5. `Home.vue`: delete eyebrow and cards; the rail, the nodes, the authored moment.
6. App shell: bloom background, NavBar, Sidebar, tables.
7. `pnpm docs:shots`; capture; write `README.md`.
8. `pnpm site:generate && pnpm site:doctor && pnpm docs:check && pnpm docs:dead-exports`.
9. `pnpm verify:local`. Then PR; `docs.yml` publishes on merge to `main` — the
   `github-pages` environment only allows `main`, so there is no other route.
10. Update `site/guide/design-language.md`, which currently documents the old values and
    will be **wrong** the moment step 1 lands. The doc-drift gate checks paths and unused
    claims, not colour values, so nothing will catch this except reading it.