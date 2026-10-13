# QA Cockpit — final plan

**Goal.** Open the folder. One screen. Know the state of QA and what is blocking you. Touch nothing.

**Ponytail verdict: approved with Slice 4 rewritten.** Three of four original slices ship unchanged in intent. The centerpiece diff panel was **halted** — not for polish, because over HTTP it diffs a number against itself. Evidence in §6.

**What changed from the previous draft, and why:** the file list went 7 → 1, auto-discovery was hardened twice, the score's headline was inverted, and the centerpiece became a two-line server fix instead of a UI panel.

---

## 0. What already exists — the reason this is a 12-hour project, not a quarter

| Capability | Where | State |
|---|---|---|
| **Report discovery** — detector decides which files are reports, with format and category | `packages/projects/src/detect/types.ts:132` emits `artifactGlobs` `{glob, format, category}` | **built** |
| **Report collection** — runner globs the workspace after a command and collects matches | `apps/runner/src/generic-spawn.ts:155` `collectArtifacts(cwd, spec.artifactGlobs, …)` | **built** |
| Report globs served per command | `apps/api/src/services/project-registry-service.ts:250` | built |
| Coverage globs, declared separately from results on purpose | `coverageGlobs`, `coverageFormats` | built |
| Project detection + re-detection | `POST /projects`, `POST /projects/:id/detect`, `packages/projects` | built — **needs a human to press it** |
| Ingest for junit / playwright / k6 / zap | `POST /api/v1/reporter/upload` | fixed earlier this session |
| 5×3 QA score + 6th `pyramid-shape` row, `total`, `cappedBy`, `cappingValue`, `surfaces` | `QaScoreSchema` | built, `superRefine`-enforced |
| Gaps / hollow / flaky / structure, all keyed by `cell` | `projects.ts:229,237,260,277` | built, 4 of 5 have UI |
| Copilot — arithmetic over the score, every suggestion citing its row | `projects.ts:324` | built, has UI |
| Global command palette, keyboard-driven | `GlobalCommandPalette` | **built — use it, do not rebuild it** |
| UI kit: `StatCard Card Badge Table Tabs Alert Toast Drawer Popover Skeleton AppShell` | `packages/ui` | built |
| Chart library | — | **none, on purpose** |

**Automatic report discovery is done.** The detector emits the globs, the runner honours them, the API knows each match's format. Nothing in this plan builds it. Slice 2 only makes the *project* discovery automatic; the *report* half already runs.

---

## 1. Six decisions

1. **`/dashboard` is the cockpit.** The launch form moves to `/dashboard/runs`. A home page that asks you to fill in a form before it tells you anything is a form.
2. **The limiter is the headline, not the total.** The score is a weighted **geometric** mean with `min(1)` renormalisation: one cell at `0.00` caps everything, so `total: 72, cappedBy: security:api, cappingValue: 0` means the other fourteen cells are nearly irrelevant. Rendering `72` as the hero number with the limiter as grey small print underneath is still a lie of emphasis — the eye takes the big number. **The cockpit opens with "what is blocking you". The total is a footnote.**
3. **`coverage: none` renders as an explicit unmeasured state, never as a colour.** See §6.2. A cell with no coverage measurement gets no green.
4. **One `since` control, in the command palette.** Not per panel, and not a bespoke component — `GlobalCommandPalette` exists, is tested, and is the right home for "compare to last deploy".
5. **Charts are inline SVG.** A 15-cell heat grid is `<rect>`s and a sparkline is a `<polyline>`. A chart dependency is 200 kB and a second visual language.
6. **No new tables, no migrations.** Every number derives from the repo and the reports at read time. Adding storage to compute something already computable is the expensive way to be wrong later.

---

## 2. Slices

### Slice 1 — `Automate` in the corner · ~10 min

`apps/web/src/components/NavBar.tsx` — the right slot holds `ThemeToggle` alone. Wordmark goes beside it:

```
[ Release Command Center ]                 Automate  [ThemeToggle]
```

Left link stays the navigation target; right side is identity.

**Red first:** one assertion in `NavBar.test.tsx` that the wordmark renders. It does not.

---

### Slice 2 — open the folder, it knows · ~2 h

**Today:** nothing happens when you open a repo. A human must `POST /api/v1/projects` with a name, a slug and a `repoPath`, then press "detect".

**After:** the API registers and re-detects the folder it was pointed at, at boot, by itself. The *report* half already runs — this only automates the *project* half.

`apps/api/src/services/project-registry-service.ts` — add:

```
discoverProject(options) →
  root = resolve(options.projectRoot)              // explicit only — see below
  if a registered project's repoPath === root → refreshProject(...)   // re-detect, never duplicate
  else → registerProject({ name: basename(root), slug: slugify(basename(root)), repoPath: root })
  log one line: what it found, or that it found nothing
```

`apps/api/src/index.ts` — call once at boot, **never fatal**. A discovery failure logs and the app serves the onboarding state. A dashboard that will not boot because a folder lacked a `package.json` is worse than a dashboard with nothing in it.

**Two hardenings, both from real failure modes:**

- **`AUTOMATE_PROJECT_ROOT` is opt-in with no default.** In compose the cwd is `/app` — which *has* a `package.json` — so defaulting to cwd registers the container as the user's project and the cockpit confidently analyses the wrong tree. Silence beats confident nonsense.
- **`slugify` must not inherit the schema's regex.** `RegisterProjectBodySchema` is `/^[a-z0-9][a-z0-9._-]*$/u`, so a folder named `My Project` 422s **at boot**. Lowercase, map every non-conforming run to `-`, and on collision **skip with a log line, never crash**.

Properties that matter and cost nothing:
- **Re-detect, never duplicate.** A `package.json` that gained a test runner yesterday must show up today with nobody pressing a button. `refreshProject` already re-reads the manifests.
- **Boot-time only.** No file watcher, no polling, no folder picker. "The moment you open the folder" is satisfied by the server starting when you start it.

**Red first**, in `project-registry-service.test.ts`:
- boot registers the folder it was pointed at, deriving name and slug from the basename
- boot **re-detects** an already-registered folder instead of creating a second project
- a folder name with a space or uppercase yields a valid slug, and a collision skips with a log rather than throwing
- boot on a folder with no detectable runner registers nothing and says so, without throwing

---

### Slice 3 — the cockpit · ~7 h · **one new file**

**Files**

| File | Change |
|---|---|
| `apps/web/src/components/Cockpit.tsx` | **new** — the whole cockpit; four row-sections as local functions |
| `apps/web/src/routes/dashboard.tsx` | split into a layout returning `<Outlet />` plus the cockpit body; launch form moves out |
| `apps/web/src/lib/qa-client.ts` | nothing new needed for slices 1–3 |

That is one new component. The previous draft specified seven; seven files would have manufactured seven prop interfaces, seven test files, and seven chances to drift, against an `apps/web` floor of 96/88/96/98.

**The route split is not cosmetic.** `dashboard.tsx:364-379` documents a live bug: `useRuns` runs before `if (!isExactDashboard) return <Outlet />`, so `/dashboard/runs` opens a **second** `EventSource` and a second 5-second poller that nothing renders. The comment says it was left unfixed because landing it cost one line of coverage against a raised floor. This rewrite is the moment, with the test that covers it.

**Layout — read top to bottom in about three seconds**

```
┌────────────────────────────────────────────────────────────────────┐
│  BLOCKING YOU          security:api 0.00    since ▸ command palette│
│  one zero caps the geometric mean, so the total below is 72        │
├──────────────┬──────────────┬──────────────┬──────────────┬───────┤
│ PASS  94%    │ FLAKE  3.1%  │ GAPS  11     │ QUARANTINE 2 │ RUNS  │
├──────────────┴──────────────┴──────────────┴──────────────┴───────┤
│                     THE 5×3 MATRIX                                │
│         unit  integration  e2e  performance  security             │
│ backend   ████    ███        ██      ▓▓▓        ░░               │
│ frontend  ███     ▒▒         ██      ██         ░░               │
│ platform  ██      ██         ░░      ██         ▒▒               │
│                                                                   │
│ ░ unmeasured   ▒ 0–40   ▓ unmeasured-coverage   ██ 60–100         │
├────────────────────────────────────────────────────────────────────┤
│  NEEDS A DECISION                                                 │
│  1. security:api 0.00 — cheapest closure: 1 ZAP rule set          │
│  2. flaky:cart   0.71 — 3 fingerprints, 12% flake                 │
├────────────────────────────────────────────────────────────────────┤
│  SUITE SHAPE  pyramid 0.42   (its own strip — see §3)             │
└────────────────────────────────────────────────────────────────────┘
```

**Rules the cockpit follows, because a dashboard that lies is worse than no dashboard**

- **The limiter is the headline** (decision 2). Total is subordinate.
- **A cell with no coverage renders as `unmeasured`, not as a colour and not as zero.** Over HTTP every cell's coverage component is structurally absent (§6.2). Colouring those cells would draw confident green on a dimension nobody measured.
- **No number without a comparison.** Every delta tile carries its `since`. A bare pass rate is a number, not an answer.
- **A gap that names no `cheapestClosure` is not in the queue.** `cheapestClosure` is required by `QaGapSchema`; the queue sorts by it.
- **Onboarding is a screen, not an empty grid.** No project → show the detected folder, what was detected, and what to do. An empty table cannot distinguish "broken" from "empty repo".
- **`pyramid-shape` is not a health dimension.** It answers "what shape is the suite", not "is the suite healthy", so it gets its own strip below the grid — never a cell inside it.

**Five parallel fetches. No aggregate endpoint.** `analytics/summary`, `qa/score`, `qa/flaky`, `qa/gaps`, `dashboard/quarantine`. A new `/cockpit` route would be a second authority over numbers that already have five, and the first thing to drift.

**Red first:** one route test asserting the cockpit renders the limiter as the headline, and one asserting a cell with no coverage renders as `unmeasured`.

---

### Slice 4 — the honest diff · ~1 h · **server, not UI**

This is the original centerpiece, and it is **two lines of server work plus one guard.** There is no panel in this slice, because a panel over a false number is worse than no panel.

1. **`readScoreInputs(options, projectId, at)`** — add the parameter; filter runs and results by `startedAt <= at`. That single change makes `at` mean something and makes the diff real for every time-series component.
2. **One guard in `diffScores`** (`packages/projects/src/score/diff.ts`): if both readings were computed from an identical row set, **refuse** — do not return an empty `contributions` array. There are already guards for cross-project (`:138`) and backwards-time (`:144`). The one case actually happening has none.
3. **Replace the false claim** at `apps/api/src/routes/projects.ts:292-295` — *"an empty diff is a true answer rather than an error"* — which is what made the defect survive review.

**Red first:**
- `readScoreInputs` given `at` returns only rows at or before it
- `diffScores` **throws** on two readings proven to share a row set, and the test names the case ("nothing changed" and "I compared nothing to nothing" are different answers)
- an unfiltered `at` cannot produce a non-empty diff

**Then, and only then**, a `ChangePanel` becomes honest: it renders `ScoreDeltaSchema.contributions[]` with the `evidence[]` the contract already requires. That is a follow-on slice, not this one.

---

## 3. Cell drill-down — deferred, deliberately

Clicking a cell opening gaps/hollow/flaky in a `Drawer` is cheap and correct: all four endpoints key their rows by `cell` and the matrix is 15 cells, so **filter client-side**. No new query parameters.

It waits because `hollow` and `flaky` are fed by the same pipeline as the score, and two of that pipeline's inputs are hardcoded empty (§6.3). Shipping a drawer over three of five sources would be shipping a panel that is right twice and empty once.

---

## 4. Not building

- **v3.0 plan phases 2–8.** OCI runner images, the runner `tool` key, `protocol_version`, durable cancel, `security:static` tiering, RF-11's OpenAPI emit. None is a QA dashboard.
- **Automatic report discovery.** It exists (§0).
- **A chart dependency.** Inline SVG.
- **A new database table or migration.**
- **A file watcher or a folder picker.** Boot-time only.
- **Findings-ledger rows for this work.** That ledger records defects in a release process. This is product work on a solo product; the tests are the record.
- **A second error boundary, a query cache, a state library, a design-system primitive beyond what the cockpit uses.**

---

## 5. Verification

Per slice: write the test, run it against code that does not do the thing yet, watch it fail for the expected reason, then write the code. Standing gates after each slice: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

The manual check that decides whether any of it worked:

1. `pnpm dev` in a fresh clone.
2. Open `http://localhost:5173`.
3. **Touch nothing.** The cockpit shows a verdict for the folder you are sitting in.

If step 3 needs a click, slice 2 did not land.

---

## 6. The finding that halted Slice 4

**1. `GET /qa/score/diff` diffs a number against itself.**
`projects.ts:310-311` calls `qaScore(…, since)` and `qaScore(…, now)`. `qaScore` → `assemble()` → `readScoreInputs(options, projectId)` (`qa-score-service.ts:62`) — **no `at`, no time filter, every row**. `packages/projects/src/score/index.ts:76` states it: *"`inputs` is the whole window, already read."* `score(inputs, at)` filters nothing; `at` is stamped on as a label. Both ends therefore read identical rows and return identical numbers, and the route subtracts one from the other.

**2. Coverage is absent from every HTTP reading.**
`qaScore(…, coverage = [])` takes coverage as a caller parameter. All seven callers (`projects.ts:218,232,240,263,280,310,311,336`) pass none, and **no route accepts a coverage document**. `mergeCoverage([])` returns `null`, and `qa-score-service.test.ts:330` states the consequence: *"Without this document the cell's coverage half is dropped."* Fifteen cells, coverage dimension structurally absent.

**3. Three inputs are hardcoded empty.** `qa-score-service.ts:88-90` — `quarantined: []`, `uncoveredModules: []`, `singleLayerE2eFingerprints: []`. So `gaps` cannot be about uncovered modules, and the single-layer-e2e structural finding is dead.

**Why this is the most dangerous shape a QA tool can have.** `ScoreDeltaSchema` requires `evidence: z.array(z.string()).min(1)`, so a false diff would not render blank — it would render *confidently, with citations, and be wrong*. A broken dashboard is ignored. A plausible one is believed, and belief is what it costs.

---

## 7. Sprint order

| Hours | Slice | Ends with |
|---|---|---|
| 1 | 1 — wordmark | the corner says `Automate` |
| 3 | 2 — auto-discovery | open a folder, touch nothing, it knows |
| 10 | 3 — cockpit | limiter-first verdict, unmeasured states honest |
| 11 | 4 — honest diff | the diff can no longer lie |
| 12 | buffer | |

---

## 8. Two decisions that are yours

1. **History needs a database.** Everything is in-memory unless `DATABASE_URL` is set, so "what changed since yesterday" is impossible today — the process forgets on exit. Slices 1–3 work in memory. **Slice 4's value requires Postgres.** Decide before slice 4, not during.
2. **Does "Automate" replace "Release Command Center" everywhere, or only in the corner?** The sidebar's first item, the `h1`, and the page title are three different strings today. One should be the product's name; the other two should be the screen's name.