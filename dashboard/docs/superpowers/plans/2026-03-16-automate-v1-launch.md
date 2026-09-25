# Automate v1.0 Launch — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Automate from a feature-rich prototype into a polished, adoption-ready v1.0 product with <60s onboarding, feature discipline, production distribution, docs site, and community signals.

**Architecture:** Six sprints layered bottom-up: foundation (feature flags) → product clarity (README/onboarding) → distribution (Docker/npm) → docs site → failure analysis polish → community/launch. Each sprint is independently shippable with a commit at every task boundary.

**Tech Stack:** Fastify 5, React 19, Vite 7, TypeScript 5.9, Tailwind CSS 4, Drizzle ORM, SQLite WAL, Docker, pnpm workspaces. New: Starlight (docs site), GitHub Container Registry (GHCR), npm (reporter publishing).

---

## Progress Dashboard

> **Overall Progress: 6/6 Sprints Complete — v1.0.0 SHIPPED**
>
> ```
> Sprint 0 — Foundation (Feature Flags)         [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (8/8 tasks)
> Sprint 1 — Product Clarity                     [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (7/7 tasks)
> Sprint 2 — Distribution                        [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (8/8 tasks)
> Sprint 3 — Docs Site                           [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (6/6 tasks)
> Sprint 4 — Failure Analysis Polish             [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (5/5 tasks)
> Sprint 5 — Community & Launch                  [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (6/6 tasks)
> ─────────────────────────────────────────────────────────────────
> TOTAL                                          [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (40/40 tasks)
> ```
>
> **Legend:** `░` = pending, `▓` = complete

---

## File Map

This section locks in which files will be created or modified across all sprints.

### New Files

| File | Responsibility |
|---|---|
| `apps/server/src/services/feature-flags.ts` | Server-side feature flag registry + env var loading |
| `apps/server/src/services/feature-flags.test.ts` | Unit tests for feature flag service |
| `apps/server/src/routes/features.ts` | `GET /api/features` endpoint returning enabled flags |
| `apps/server/src/routes/features.test.ts` | Tests for features route |
| `apps/client/src/store/featureStore.ts` | Zustand store fetching + caching feature flags |
| `apps/client/src/store/featureStore.test.ts` | Tests for feature store |
| `apps/client/src/components/FeatureGate.tsx` | `<FeatureGate flag="xxx">` wrapper component |
| `apps/client/src/components/FeatureGate.test.tsx` | Tests for FeatureGate |
| `packages/reporter/README.md` | npm package README for @automate/reporter |
| `.github/workflows/publish-reporter.yml` | CI workflow to publish reporter to npm |
| `.github/workflows/publish-docker.yml` | CI workflow to build + push Docker image to GHCR |
| `docs-site/` | Starlight docs site (entire directory — `astro.config.mjs`, `src/content/docs/`, etc.) |
| `docs/assets/screenshot-dashboard.png` | Hero screenshot for README + docs |
| `docs/assets/screenshot-run-detail.png` | Run detail page screenshot |
| `CONTRIBUTING.md` | Community contribution guide |
| `CHANGELOG.md` | Version changelog |

### Modified Files

| File | Change |
|---|---|
| `apps/server/src/index.ts` | Register `featuresRoutes`, conditionally register node-pty routes |
| `apps/server/src/services/reporter-bridge.ts` | Extract integration dispatch to separate file, guard AI/NL behind flags |
| `apps/server/src/routes/quarantine.ts` | Guard behind `auto-quarantine` feature flag |
| `apps/server/src/routes/nl-query.ts` | Guard behind `nl-query` feature flag |
| `apps/server/src/services/ai-explain.ts` | Guard behind `ai-explain` feature flag |
| `apps/server/src/routes/schedules.ts` | Guard behind `scheduled-runs` feature flag |
| `apps/server/src/routes/baselines.ts` | Guard behind `baseline-management` feature flag |
| `apps/server/src/routes/codegen.ts` | Guard behind `codegen-launcher` feature flag |
| `apps/client/src/components/onboarding/OnboardingWizard.tsx` | Complete redesign — 2-step zero-question flow |
| `apps/client/src/store/onboardingStore.ts` | Simplify state for new onboarding flow |
| `packages/reporter/package.json` | Add `repository`, `homepage`, `bugs` fields for npm |
| `packages/cli/src/index.ts` | Streamline to zero-question flow |
| `Dockerfile` | Make node-pty optional, reduce image size |
| `docker-compose.yml` | Simplify for single `docker run` story |
| `README.md` | Complete rewrite — 5-section adoption-focused README |
| `package.json` | Version bump to 1.0.0 |

---

## Chunk 1: Sprint 0 — Foundation (Feature Flags)

> **Sprint Goal:** Build a feature flag system so we can hide v2+ features and present a focused v1 core.
>
> **Why first:** Every other sprint depends on being able to toggle features. Without flags, we can't trim the feature surface.

### Task 0.1: Server-side feature flag service

**Files:**
- Create: `apps/server/src/services/feature-flags.ts`
- Create: `apps/server/src/services/feature-flags.test.ts`

**Design:** Flags are defined in code with defaults. Each flag can be overridden by an env var `FEATURE_<FLAG_NAME>=true|false`. No database table — env vars are the source of truth. This keeps it stateless and Docker/CI-friendly.

- [x] **Step 1: Write the failing test**

Create `apps/server/src/services/feature-flags.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('feature-flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default flags when no env vars set', async () => {
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();
    expect(flags['auto-quarantine']).toBe(false);
    expect(flags['live-run-monitoring']).toBe(true);
  });

  it('overrides a default-off flag via env var', async () => {
    process.env.FEATURE_AUTO_QUARANTINE = 'true';
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();
    expect(flags['auto-quarantine']).toBe(true);
  });

  it('overrides a default-on flag via env var', async () => {
    process.env.FEATURE_LIVE_RUN_MONITORING = 'false';
    const { getFeatureFlags } = await import('./feature-flags.js');
    const flags = getFeatureFlags();
    expect(flags['live-run-monitoring']).toBe(false);
  });

  it('isEnabled() returns boolean for known flags', async () => {
    const { isEnabled } = await import('./feature-flags.js');
    expect(typeof isEnabled('auto-quarantine')).toBe('boolean');
  });

  it('isEnabled() returns false for unknown flags', async () => {
    const { isEnabled } = await import('./feature-flags.js');
    expect(isEnabled('nonexistent-flag' as any)).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/dashboard-server exec vitest run src/services/feature-flags.test.ts`
Expected: FAIL — module `./feature-flags.js` does not exist.

- [x] **Step 3: Implement the feature flag service**

Create `apps/server/src/services/feature-flags.ts`:

```typescript
/**
 * feature-flags.ts — Server-side feature flag registry
 *
 * Flags are defined with defaults. Override via env vars:
 *   FEATURE_AUTO_QUARANTINE=true  →  enables auto-quarantine
 *
 * Convention: flag name "auto-quarantine" → env var "FEATURE_AUTO_QUARANTINE"
 */

export type FeatureFlagName =
  | 'live-run-monitoring'
  | 'test-explorer'
  | 'analytics-dashboard'
  | 'artifact-viewers'
  | 'run-comparison'
  | 'integration-hooks'
  | 'command-palette'
  | 'quality-gate'
  // v2+ features — default OFF
  | 'auto-quarantine'
  | 'nl-query'
  | 'error-clustering'
  | 'impact-analysis'
  | 'ai-explain'
  | 'scheduled-runs'
  | 'codegen-launcher'
  | 'pr-comparison'
  | 'baseline-management'
  | 'known-failure-tracking'
  | 'terminal-runner';

/** Default flag states — v1 core is ON, experimental is OFF */
const FLAG_DEFAULTS: Record<FeatureFlagName, boolean> = {
  'live-run-monitoring': true,
  'test-explorer': true,
  'analytics-dashboard': true,
  'artifact-viewers': true,
  'run-comparison': true,
  'integration-hooks': true,
  'command-palette': true,
  'quality-gate': true,
  // v2+ — off by default
  'auto-quarantine': false,
  'nl-query': false,
  'error-clustering': false,
  'impact-analysis': false,
  'ai-explain': false,
  'scheduled-runs': false,
  'codegen-launcher': false,
  'pr-comparison': false,
  'baseline-management': false,
  'known-failure-tracking': false,
  'terminal-runner': false,
};

function flagToEnvVar(flag: FeatureFlagName): string {
  return `FEATURE_${flag.toUpperCase().replace(/-/g, '_')}`;
}

function resolveFlag(flag: FeatureFlagName): boolean {
  const envVal = process.env[flagToEnvVar(flag)];
  if (envVal === 'true' || envVal === '1') return true;
  if (envVal === 'false' || envVal === '0') return false;
  return FLAG_DEFAULTS[flag];
}

/** Get all feature flags with their resolved values */
export function getFeatureFlags(): Record<FeatureFlagName, boolean> {
  const result = {} as Record<FeatureFlagName, boolean>;
  for (const flag of Object.keys(FLAG_DEFAULTS) as FeatureFlagName[]) {
    result[flag] = resolveFlag(flag);
  }
  return result;
}

/** Check if a specific feature is enabled */
export function isEnabled(flag: FeatureFlagName): boolean {
  if (!(flag in FLAG_DEFAULTS)) return false;
  return resolveFlag(flag);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/dashboard-server exec vitest run src/services/feature-flags.test.ts`
Expected: All 5 tests PASS.

- [x] **Step 5: Commit**

```bash
git add apps/server/src/services/feature-flags.ts apps/server/src/services/feature-flags.test.ts
git commit -m "feat: add server-side feature flag service with env var overrides"
```

---

### Task 0.2: Feature flags REST endpoint

**Files:**
- Create: `apps/server/src/routes/features.ts`
- Create: `apps/server/src/routes/features.test.ts`
- Modify: `apps/server/src/index.ts` (register route)

- [x] **Step 1: Write the failing test**

Create `apps/server/src/routes/features.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { featuresRoutes } from './features.js';

describe('GET /api/features', () => {
  it('returns feature flags as JSON object', async () => {
    const app = Fastify();
    await featuresRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/features' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('live-run-monitoring');
    expect(typeof body['live-run-monitoring']).toBe('boolean');
    expect(body).toHaveProperty('auto-quarantine');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/dashboard-server exec vitest run src/routes/features.test.ts`
Expected: FAIL — module `./features.js` does not exist.

- [x] **Step 3: Implement the features route**

Create `apps/server/src/routes/features.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { getFeatureFlags } from '../services/feature-flags.js';

export async function featuresRoutes(app: FastifyInstance) {
  app.get('/api/features', async () => {
    return getFeatureFlags();
  });
}
```

- [x] **Step 4: Register route in server index**

In `apps/server/src/index.ts`:

Add import at the top (after line 55, with the other route imports):
```typescript
import { featuresRoutes } from './routes/features.js';
```

Add route registration after `await prIntegrationRoutes(app);` (after line 130):
```typescript
await featuresRoutes(app);
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @automate/dashboard-server exec vitest run src/routes/features.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/server/src/routes/features.ts apps/server/src/routes/features.test.ts apps/server/src/index.ts
git commit -m "feat: add GET /api/features endpoint for client feature flag consumption"
```

---

### Task 0.3: Client-side feature flag store

**Files:**
- Create: `apps/client/src/store/featureStore.ts`
- Create: `apps/client/src/store/featureStore.test.ts`

**Design:** Zustand store that fetches `/api/features` once on app load, caches in memory, and exposes a `useFeature(flag)` hook returning `boolean`.

- [x] **Step 1: Write the failing test**

Create `apps/client/src/store/featureStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock fetch before importing the store
const mockFlags = {
  'live-run-monitoring': true,
  'auto-quarantine': false,
  'ai-explain': false,
};

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(mockFlags),
  } as Response),
);

describe('featureStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exports useFeatureStore and useFeature', async () => {
    const mod = await import('./featureStore.js');
    expect(mod.useFeatureStore).toBeDefined();
    expect(mod.useFeature).toBeDefined();
  });

  it('useFeature returns false for disabled flags', async () => {
    const { useFeature } = await import('./featureStore.js');
    // Trigger fetch
    const { useFeatureStore } = await import('./featureStore.js');
    useFeatureStore.getState().fetchFlags();

    await waitFor(() => {
      expect(useFeatureStore.getState().loaded).toBe(true);
    });

    const { result } = renderHook(() => useFeature('auto-quarantine'));
    expect(result.current).toBe(false);
  });

  it('useFeature returns true for enabled flags', async () => {
    const { useFeature, useFeatureStore } = await import('./featureStore.js');
    useFeatureStore.getState().fetchFlags();

    await waitFor(() => {
      expect(useFeatureStore.getState().loaded).toBe(true);
    });

    const { result } = renderHook(() => useFeature('live-run-monitoring'));
    expect(result.current).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/dashboard-client exec vitest run src/store/featureStore.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement the feature store**

Create `apps/client/src/store/featureStore.ts`:

```typescript
import { create } from 'zustand';

type FeatureFlags = Record<string, boolean>;

interface FeatureState {
  flags: FeatureFlags;
  loaded: boolean;
  error: string | null;
  fetchFlags: () => Promise<void>;
}

export const useFeatureStore = create<FeatureState>((set, get) => ({
  flags: {},
  loaded: false,
  error: null,
  fetchFlags: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/features');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const flags = await res.json();
      set({ flags, loaded: true, error: null });
    } catch (err) {
      set({ error: (err as Error).message, loaded: true });
    }
  },
}));

/** Hook: returns whether a feature flag is enabled. Defaults to false if not loaded. */
export function useFeature(flag: string): boolean {
  return useFeatureStore((s) => s.flags[flag] ?? false);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/dashboard-client exec vitest run src/store/featureStore.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/client/src/store/featureStore.ts apps/client/src/store/featureStore.test.ts
git commit -m "feat: add client-side feature flag Zustand store with useFeature hook"
```

---

### Task 0.4: FeatureGate UI component

**Files:**
- Create: `apps/client/src/components/FeatureGate.tsx`
- Create: `apps/client/src/components/FeatureGate.test.tsx`

- [x] **Step 1: Write the failing test**

Create `apps/client/src/components/FeatureGate.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the feature store
vi.mock('@/store/featureStore', () => ({
  useFeature: vi.fn((flag: string) => flag === 'enabled-feature'),
}));

describe('FeatureGate', () => {
  it('renders children when flag is enabled', async () => {
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="enabled-feature">
        <div data-testid="child">Visible</div>
      </FeatureGate>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders nothing when flag is disabled', async () => {
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="disabled-feature">
        <div data-testid="child">Hidden</div>
      </FeatureGate>
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders fallback when flag is disabled and fallback provided', async () => {
    const { FeatureGate } = await import('./FeatureGate.js');
    render(
      <FeatureGate flag="disabled-feature" fallback={<div data-testid="fallback">Alt</div>}>
        <div data-testid="child">Hidden</div>
      </FeatureGate>
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/dashboard-client exec vitest run src/components/FeatureGate.test.tsx`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement FeatureGate**

Create `apps/client/src/components/FeatureGate.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useFeature } from '@/store/featureStore';

interface FeatureGateProps {
  flag: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  const enabled = useFeature(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/dashboard-client exec vitest run src/components/FeatureGate.test.tsx`
Expected: All 3 tests PASS.

- [x] **Step 5: Commit**

```bash
git add apps/client/src/components/FeatureGate.tsx apps/client/src/components/FeatureGate.test.tsx
git commit -m "feat: add FeatureGate component for conditional UI rendering"
```

---

### Task 0.5: Guard v2 features on server side

**Files:**
- Modify: `apps/server/src/routes/quarantine.ts` (guard auto-quarantine)
- Modify: `apps/server/src/routes/nl-query.ts` (guard NL query)
- Modify: `apps/server/src/services/ai-explain.ts` (guard AI explain)
- Modify: `apps/server/src/routes/schedules.ts` (guard scheduled runs)
- Modify: `apps/server/src/routes/baselines.ts` (guard baselines)
- Modify: `apps/server/src/routes/codegen.ts` (guard codegen)

**Pattern:** Each guarded route file should import `isEnabled` and return 404 with a message when disabled. Apply the guard at the route registration level inside each route function.

- [x] **Step 1: Create a reusable guard helper**

Add to the bottom of `apps/server/src/services/feature-flags.ts`:

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Fastify preHandler hook that returns 404 when a feature is disabled */
export function requireFeature(flag: FeatureFlagName) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!isEnabled(flag)) {
      reply.status(404).send({ error: `Feature '${flag}' is not enabled` });
    }
  };
}
```

- [x] **Step 2: Guard auto-quarantine routes**

In `apps/server/src/routes/quarantine.ts`, add at the top:

```typescript
import { requireFeature } from '../services/feature-flags.js';
```

Then wrap all route registrations inside a preHandler. The specific implementation depends on the file structure, but the pattern is:

```typescript
// Inside the route function, add preHandler to each route:
app.get('/api/quarantine', { preHandler: requireFeature('auto-quarantine') }, async (req, reply) => {
  // existing handler
});
```

Repeat for all routes in this file.

- [x] **Step 3: Guard NL query routes**

In `apps/server/src/routes/nl-query.ts`, add:
```typescript
import { requireFeature } from '../services/feature-flags.js';
```
Add `{ preHandler: requireFeature('nl-query') }` to all routes.

- [x] **Step 4: Guard AI explain routes**

In `apps/server/src/services/ai-explain.ts`, add:
```typescript
import { requireFeature } from './feature-flags.js';
```
Add `{ preHandler: requireFeature('ai-explain') }` to all routes.

- [x] **Step 5: Guard scheduled runs, baselines, and codegen routes**

Apply the same pattern to:
- `apps/server/src/routes/schedules.ts` → `requireFeature('scheduled-runs')`
- `apps/server/src/routes/baselines.ts` → `requireFeature('baseline-management')`
- `apps/server/src/routes/codegen.ts` → `requireFeature('codegen-launcher')`

- [x] **Step 6: Run full server test suite**

Run: `pnpm --filter @automate/dashboard-server test`
Expected: All existing tests pass. No regressions.

- [x] **Step 7: Commit**

```bash
git add apps/server/src/services/feature-flags.ts apps/server/src/routes/quarantine.ts apps/server/src/routes/nl-query.ts apps/server/src/services/ai-explain.ts apps/server/src/routes/schedules.ts apps/server/src/routes/baselines.ts apps/server/src/routes/codegen.ts
git commit -m "feat: guard v2 features behind feature flags on server routes"
```

---

### Task 0.6: Guard v2 features on client side

**Files:**
- Modify: Multiple client components to wrap with `<FeatureGate>`

**Pattern:** Find navigation items/tabs/buttons for v2 features and wrap them.

- [x] **Step 1: Initialize feature store on app load**

Find the root app component (likely `apps/client/src/App.tsx` or the root route) and add:

```typescript
import { useFeatureStore } from '@/store/featureStore';
import { useEffect } from 'react';

// Inside the component:
const fetchFlags = useFeatureStore((s) => s.fetchFlags);
useEffect(() => { fetchFlags(); }, [fetchFlags]);
```

- [x] **Step 2: Wrap sidebar/navigation items for v2 features**

Find the sidebar component and wrap navigation items for:
- Codegen → `<FeatureGate flag="codegen-launcher">`
- Baselines → `<FeatureGate flag="baseline-management">`
- Schedules → `<FeatureGate flag="scheduled-runs">`

These items should simply not render when the flag is off.

- [x] **Step 3: Wrap AI Explain button**

In `apps/client/src/components/tests/AiExplainButton.tsx` (180 lines), wrap the entire export:

```tsx
import { FeatureGate } from '@/components/FeatureGate';

// Wrap the exported component
export function AiExplainButton(props: AiExplainButtonProps) {
  return (
    <FeatureGate flag="ai-explain">
      <AiExplainButtonInner {...props} />
    </FeatureGate>
  );
}
```

Rename the existing component to `AiExplainButtonInner`.

- [x] **Step 4: Wrap NL Query interface**

Find the NL query component and wrap with `<FeatureGate flag="nl-query">`.

- [x] **Step 5: Run full client test suite**

Run: `pnpm --filter @automate/dashboard-client test`
Expected: All tests pass. Some snapshot tests may need updating if they include v2 UI elements.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: gate v2 UI features behind feature flags on client"
```

---

### Task 0.7: Make node-pty optional

**Files:**
- Modify: `apps/server/src/index.ts` (conditionally import runner)
- Modify: `apps/server/src/services/runner.ts` (graceful degradation)
- Modify: `Dockerfile` (remove python3/make/g++ from production stage)

**Why:** node-pty requires python3 + make + g++ to compile. This is the #1 pain point for Docker images and new users. Most users don't need the terminal runner — they run Playwright from their own CI.

- [x] **Step 1: Guard terminal runner behind feature flag**

The `terminal-runner` flag defaults to `false`. In `apps/server/src/index.ts`, change the runner-related code to only activate when the flag is on:

```typescript
import { isEnabled } from './services/feature-flags.js';

// In bootstrap(), conditionally import and start the runner:
if (isEnabled('terminal-runner')) {
  try {
    const { startWatcher } = await import('./services/watcher.js');
    const watcher = startWatcher(ARTIFACTS_DIR, bridge);
    app.log.info(`Watching artifacts: ${ARTIFACTS_DIR}`);
  } catch (err) {
    app.log.warn({ err }, 'Terminal runner disabled — node-pty not available');
  }
}
```

Note: The watcher is separate from the terminal runner (watcher uses chokidar, not node-pty). Keep the watcher always active. Only the `runner.ts` service (which spawns Playwright via node-pty) should be conditional.

- [x] **Step 2: Update Dockerfile to remove build tools from production stage**

In `Dockerfile`, remove line 42 (`RUN apk add --no-cache python3 make g++`) from the production stage. node-pty is no longer needed by default.

Keep it in the builder stage (line 8) in case someone builds with `FEATURE_TERMINAL_RUNNER=true`.

- [x] **Step 3: Run Docker build to verify**

Run: `docker build -t automate:test .`
Expected: Build succeeds. Image size should be notably smaller without g++/python3.

- [x] **Step 4: Commit**

```bash
git add apps/server/src/index.ts Dockerfile
git commit -m "feat: make node-pty optional behind terminal-runner flag, slim Docker image"
```

---

### Task 0.8: Sprint 0 verification

- [x] **Step 1: Run full test suite**

```bash
pnpm --filter @automate/dashboard-server test
pnpm --filter @automate/dashboard-client test
```

Expected: All tests pass.

- [x] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No type errors.

- [x] **Step 3: Test feature flag behavior**

Start the dev server and verify:
1. `GET /api/features` returns all flags with correct defaults
2. UI does NOT show codegen, baselines, schedules, AI explain, NL query
3. Set `FEATURE_AI_EXPLAIN=true` env var, restart — AI explain button appears
4. Terminal-related features gracefully degrade

- [x] **Step 4: Update progress dashboard**

In this file, update Sprint 0 progress bar to show `[▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%` and `(8/8 tasks)`.

---

## Chunk 2: Sprint 1 — Product Clarity

> **Sprint Goal:** Rewrite README for <2 minute comprehension. Redesign onboarding for <60 second first-run.
>
> **Depends on:** Sprint 0 (feature flags must be in place so README reflects v1 scope).

### Task 1.1: Take product screenshots

**Files:**
- Create: `docs/assets/screenshot-dashboard.png`
- Create: `docs/assets/screenshot-run-detail.png`
- Create: `docs/assets/screenshot-analytics.png`

- [x] **Step 1: Start the dev server with seed data**

```bash
pnpm dev
# In another terminal:
pnpm seed:perf  # Seeds test data for realistic screenshots
```

- [x] **Step 2: Capture screenshots**

Using the browser:
1. Navigate to `http://localhost:5173` → screenshot the dashboard with KPI cards and recent runs → save as `docs/assets/screenshot-dashboard.png`
2. Navigate to a run detail page → screenshot with test tree visible → save as `docs/assets/screenshot-run-detail.png`
3. Navigate to `/analytics` → screenshot pass-rate trends → save as `docs/assets/screenshot-analytics.png`

Optimize each image: target <500KB per image. Use PNG or WebP.

- [x] **Step 3: Commit**

```bash
git add docs/assets/
git commit -m "docs: add product screenshots for README and docs"
```

---

### Task 1.2: Rewrite README.md

**Files:**
- Modify: `README.md`

**Structure:** The README must answer 5 questions in order:
1. **What is it?** (1 sentence + screenshot)
2. **Why should I care?** (3 bullet differentiators)
3. **How do I try it?** (single command)
4. **How do I connect my tests?** (3 lines of config)
5. **Where do I go next?** (links to docs)

- [x] **Step 1: Write the new README**

Replace the entire `README.md` content. Key changes:
- Remove the massive feature table (move to docs site)
- Remove tech stack table (move to docs site)
- Remove project structure (move to docs site)
- Remove scaling section (move to docs site)
- Add hero screenshot
- Simplify Quick Start to `docker run` (single command, no git clone)
- Add "Connect Your Tests" as a 3-line code block
- Fix placeholder GitHub URLs

The new README should be ~120 lines max (current is 376).

```markdown
<p align="center">
  <h1 align="center">Automate</h1>
  <p align="center">
    <strong>Self-hosted Playwright dashboard.</strong> Real-time monitoring, failure analysis, and historical trends — zero infrastructure.
  </p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT" /></a>
  <a href="https://www.npmjs.com/package/@automate/reporter"><img src="https://img.shields.io/npm/v/@automate/reporter" alt="npm" /></a>
  <a href="https://ghcr.io/YOUR_USERNAME/automate"><img src="https://img.shields.io/badge/Docker-GHCR-2496ED" alt="Docker" /></a>
</p>

<p align="center">
  <img src="docs/assets/screenshot-dashboard.png" alt="Automate" width="900" />
</p>

---

## Why Automate?

- **Zero infrastructure** — SQLite + single binary. No Postgres, Redis, or Java.
- **Playwright-native** — streams results in real-time via custom reporter. Not a generic test tool.
- **Self-hosted** — your data stays on your machine. No SaaS lock-in, no per-seat pricing.

---

## Quick Start

```bash
docker run -d -p 4000:4000 -p 4001:4001 ghcr.io/YOUR_USERNAME/automate:latest
```

Open [http://localhost:4000](http://localhost:4000).

---

## Connect Your Tests

Install the reporter:

```bash
npm install -D @automate/reporter
```

Add to `playwright.config.ts`:

```typescript
export default defineConfig({
  reporter: [['list'], ['@automate/reporter']],
});
```

Run your tests:

```bash
AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test
```

Results stream to the dashboard in real-time.

---

## Features

| | |
|---|---|
| **Live Monitoring** | Watch tests execute in real-time via WebSocket |
| **Failure Analysis** | Screenshot diffs, video playback, trace viewer, step timeline |
| **Analytics** | Pass-rate trends, duration charts, flaky leaderboard, failure heatmap |
| **Test Explorer** | Groupable tree view with search and filters |
| **Run Comparison** | Side-by-side diff of any two runs |
| **Integrations** | Slack, Jira, GitHub — webhook notifications |
| **Quality Gates** | Pass-rate thresholds for CI/CD pipelines |

> 💡 Advanced features (AI explain, NL query, auto-quarantine, codegen) are available via [feature flags](docs-site/features.md).

---

## Documentation

- [Getting Started](docs-site/getting-started.md)
- [Deployment Guide](docs-site/deployment.md)
- [Configuration](docs-site/configuration.md)
- [API Reference](docs-site/api.md)
- [Architecture](docs-site/architecture.md)

---

## Development

```bash
git clone https://github.com/YOUR_USERNAME/automate.git
cd automate
pnpm install
pnpm dev
```

See [Contributing](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE)
```

Note: Replace `YOUR_USERNAME` with actual GitHub username before publishing.

- [x] **Step 2: Verify README renders correctly**

Open the README in a Markdown preview and verify:
- Screenshot displays
- Badge links work
- Code blocks are correct
- No broken links (docs links will point to future docs site)

- [x] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for adoption-focused clarity"
```

---

### Task 1.3: Redesign onboarding wizard — zero questions

**Files:**
- Modify: `apps/client/src/components/onboarding/OnboardingWizard.tsx`
- Modify: `apps/client/src/store/onboardingStore.ts`

**New design:** The onboarding wizard should be **2 steps, zero questions**:
1. **Welcome** — "Automate is ready. Here's how to connect your tests:" + copy-paste snippet
2. **Waiting** — "Waiting for first test run..." with a WebSocket listener that auto-advances when data arrives

No config detection, no project import, no scan. The user's Playwright project is on a different machine — the dashboard is a server.

- [x] **Step 1: Write the test for the new onboarding**

Create or update `apps/client/src/components/onboarding/OnboardingWizard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingWizard } from './OnboardingWizard';

// Mock stores
vi.mock('@/store/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({
    hasCompletedOnboarding: false,
    setCompleted: vi.fn(),
  })),
}));

vi.mock('@/store/wsStore', () => ({
  useWsStore: vi.fn(() => ({
    lastMessage: null,
  })),
}));

describe('OnboardingWizard', () => {
  it('shows connection instructions on first render', () => {
    render(<OnboardingWizard />);
    expect(screen.getByText(/npm install -D @automate/reporter/i)).toBeInTheDocument();
  });

  it('shows waiting state after clicking Next', async () => {
    const { user } = render(<OnboardingWizard />);
    // This test will need userEvent setup — adapt to existing test patterns
  });
});
```

- [x] **Step 2: Rewrite the OnboardingWizard component**

Replace `apps/client/src/components/onboarding/OnboardingWizard.tsx` with a new 2-step zero-question flow:

**Step 1 (Connect):** Shows:
- "Install the reporter: `npm install -D @automate/reporter`"
- "Add to playwright.config.ts: `reporter: [['list'], ['@automate/reporter']]`"
- "Run: `AUTOMATE_DASHBOARD_URL=http://<this-host>:4000 npx playwright test`"
- Copy buttons for each snippet
- "Next" button

**Step 2 (Waiting):** Shows:
- Animated "Waiting for first test run..." with a pulsing dot
- Subscribe to WebSocket — when `run:start` is received, auto-complete onboarding
- "Skip" link to dismiss

Target: 120 lines max (current is 236 lines).

- [x] **Step 3: Run onboarding tests**

Run: `pnpm --filter @automate/dashboard-client exec vitest run src/components/onboarding/`
Expected: PASS.

- [x] **Step 4: Manual test**

1. Clear localStorage (to reset onboarding state)
2. Load the dashboard
3. Verify the wizard shows connection instructions
4. Verify no questions are asked
5. Verify the waiting state listens for WebSocket events

- [x] **Step 5: Commit**

```bash
git add apps/client/src/components/onboarding/
git commit -m "feat: redesign onboarding wizard to zero-question connection flow"
```

---

### Task 1.4: Streamline CLI to zero questions

**Files:**
- Modify: `packages/cli/src/index.ts`

**Current problems:**
- Asks for server URL (should auto-detect or use default)
- Asks for reporter port (redundant — AUTOMATE_DASHBOARD_URL includes it)
- Asks whether to install reporter (just do it)
- Asks whether to update config (just do it)

**New flow:** `npx Automate init` should:
1. Detect package manager
2. Install `@automate/reporter`
3. Auto-update `playwright.config.ts` if found
4. Print the `AUTOMATE_DASHBOARD_URL` env var to set
5. Done. Zero prompts.

- [x] **Step 1: Rewrite the CLI**

Replace `packages/cli/src/index.ts`:

```typescript
#!/usr/bin/env node

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const cwd = process.cwd();

function detectPackageManager(): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function findPlaywrightConfig(): string | null {
  for (const name of ['playwright.config.ts', 'playwright.config.js']) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function patchConfig(configPath: string): boolean {
  const content = fs.readFileSync(configPath, 'utf8');
  if (content.includes('@automate/reporter')) {
    console.log('  ✓ @automate/reporter already in config');
    return false;
  }

  const match = content.match(/reporter\s*:\s*\[/);
  if (!match || match.index === undefined) {
    console.log('  ⚠ Could not find reporter array — add manually:');
    console.log("    reporter: [['list'], ['@automate/reporter']]");
    return false;
  }

  const insertAt = match.index + match[0].length;
  const updated = content.slice(0, insertAt) + "\n    ['@automate/reporter']," + content.slice(insertAt);
  fs.writeFileSync(configPath, updated, 'utf8');
  return true;
}

function run() {
  console.log('⚡ Automate Setup\n');

  // Step 1: Install reporter
  const pm = detectPackageManager();
  const installCmd = { pnpm: 'pnpm add -D', yarn: 'yarn add -D', npm: 'npm install -D' }[pm];
  console.log(`1. Installing @automate/reporter (${pm})...`);
  try {
    execSync(`${installCmd} @automate/reporter`, { stdio: 'inherit', cwd });
    console.log('  ✓ Installed\n');
  } catch {
    console.log('  ⚠ Install failed — run manually: npm install -D @automate/reporter\n');
  }

  // Step 2: Patch config
  const config = findPlaywrightConfig();
  if (config) {
    console.log(`2. Updating ${path.basename(config)}...`);
    const patched = patchConfig(config);
    if (patched) console.log('  ✓ Added @automate/reporter to config\n');
  } else {
    console.log('2. No playwright.config found — add reporter manually:\n');
    console.log("   reporter: [['list'], ['@automate/reporter']]\n");
  }

  // Step 3: Done
  console.log('3. Run your tests with:\n');
  console.log('   AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test\n');
  console.log('Done! Open http://localhost:4000 to see results.');
}

const command = process.argv[2];
if (command !== 'init') {
  console.log('Usage: Automate init');
  process.exit(0);
}

run();
```

- [x] **Step 2: Remove `prompts` dependency**

```bash
cd packages/cli
pnpm remove prompts @types/prompts
```

Update `packages/cli/package.json` if needed.

- [x] **Step 3: Test manually**

```bash
cd /tmp/test-project
npx Automate init
```

Expected: Installs reporter, patches config, prints instructions. Zero prompts.

- [x] **Step 4: Commit**

```bash
git add packages/cli/
git commit -m "feat: streamline CLI to zero-question setup flow"
```

---

### Task 1.5: Update placeholder GitHub URLs

**Files:**
- Modify: Multiple files with `your-username` placeholders

- [x] **Step 1: Search for placeholder URLs**

```bash
grep -r "your-username" --include="*.md" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.ts" .
```

- [x] **Step 2: Replace all occurrences**

Replace `your-username` with the actual GitHub username/org. If not yet decided, use a consistent placeholder like `automate-hq` and leave a TODO.

- [x] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: update GitHub URL placeholders"
```

---

### Task 1.6: Add .env.example

**Files:**
- Create: `.env.example`

- [x] **Step 1: Create the file**

```env
# Automate Configuration
# Copy to .env and customize

# Server
PORT=4000
REPORTER_PORT=4001
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# CORS (restrict in production)
CORS_ORIGIN=*

# Data directories
DATA_DIR=./data
ARTIFACTS_DIR=./test-results

# Public URL for notification links (set to your domain in production)
PUBLIC_DASHBOARD_URL=

# Sentry error tracking (optional)
SENTRY_DSN=

# Feature flags (set to true/false to override defaults)
# FEATURE_AI_EXPLAIN=true
# FEATURE_NL_QUERY=true
# FEATURE_SCHEDULED_RUNS=true
# FEATURE_CODEGEN_LAUNCHER=true
# FEATURE_TERMINAL_RUNNER=true
# FEATURE_AUTO_QUARANTINE=true
# FEATURE_BASELINE_MANAGEMENT=true
```

- [x] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add .env.example with all configuration options"
```

---

### Task 1.7: Sprint 1 verification

- [x] **Step 1: Full test suite**

```bash
pnpm --filter @automate/dashboard-server test
pnpm --filter @automate/dashboard-client test
pnpm typecheck
```

- [x] **Step 2: Manual end-to-end check**

1. Fresh clone → `pnpm install` → `pnpm dev` → verify onboarding shows connection instructions
2. Verify README renders with screenshots
3. Verify no v2 features visible in UI

- [x] **Step 3: Update progress dashboard**

Update Sprint 1 progress bar to `100%` and `(7/7 tasks)`.

---

## Chunk 3: Sprint 2 — Distribution

> **Sprint Goal:** Single `docker run` command works. Reporter published to npm. Docker image on GHCR.
>
> **Depends on:** Sprint 0 (node-pty optional), Sprint 1 (README references `docker run` and `npm install @automate/reporter`).

### Task 2.1: Optimize Dockerfile for single `docker run`

**Files:**
- Modify: `Dockerfile`

- [x] **Step 1: Ensure Dockerfile works without node-pty in production stage**

After Sprint 0, the production stage should no longer need python3/make/g++. Verify the Dockerfile from Task 0.7 is correct.

- [x] **Step 2: Add LABEL metadata for GHCR**

Add to the production stage:

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/YOUR_USERNAME/automate"
LABEL org.opencontainers.image.description="Self-hosted Playwright QA Dashboard"
LABEL org.opencontainers.image.licenses="MIT"
```

- [x] **Step 3: Build and test the image**

```bash
docker build -t automate:v1 .
docker run -d -p 4000:4000 -p 4001:4001 --name automate-test automate:v1
# Wait 5 seconds
curl http://localhost:4000/health/live
# Expected: {"status":"ok","ts":...}
docker stop automate-test && docker rm automate-test
```

- [x] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: optimize Docker image — remove build tools from prod, add OCI labels"
```

---

### Task 2.2: GitHub Actions — publish Docker image to GHCR

**Files:**
- Create: `.github/workflows/publish-docker.yml`

- [x] **Step 1: Create the workflow**

```yaml
name: Publish Docker Image

on:
  push:
    tags: ['v*']
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
            type=raw,value=latest

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [x] **Step 2: Commit**

```bash
git add .github/workflows/publish-docker.yml
git commit -m "ci: add GitHub Actions workflow to publish Docker image to GHCR"
```

---

### Task 2.3: Prepare reporter package for npm publishing

**Files:**
- Modify: `packages/reporter/package.json`
- Create: `packages/reporter/README.md`

- [x] **Step 1: Add npm metadata to package.json**

Update `packages/reporter/package.json` — add these fields:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/automate.git",
    "directory": "packages/reporter"
  },
  "homepage": "https://github.com/YOUR_USERNAME/automate#connect-your-tests",
  "bugs": {
    "url": "https://github.com/YOUR_USERNAME/automate/issues"
  },
  "author": "YOUR_NAME",
  "publishConfig": {
    "access": "public"
  }
}
```

- [x] **Step 2: Create reporter README**

Create `packages/reporter/README.md`:

```markdown
# @automate/reporter

Playwright test reporter for [Automate](https://github.com/YOUR_USERNAME/automate) — streams test results to your self-hosted dashboard in real-time.

## Install

```bash
npm install -D @automate/reporter
```

## Setup

Add to `playwright.config.ts`:

```typescript
export default defineConfig({
  reporter: [
    ['list'],
    ['@automate/reporter'],
  ],
});
```

## Usage

Set `AUTOMATE_DASHBOARD_URL` to your Automate server:

```bash
# Local
AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test

# Remote (CI)
AUTOMATE_DASHBOARD_URL=https://your-automate-server.com npx playwright test
```

## Options

| Option | Default | Description |
|---|---|---|
| `port` | `4001` | WebSocket port (only needed without AUTOMATE_DASHBOARD_URL) |
| `host` | `localhost` | WebSocket host (only needed without AUTOMATE_DASHBOARD_URL) |
| `runId` | auto-generated | Override the run ID |

## How it Works

The reporter connects to Automate's WebSocket server and streams lifecycle events (`run:start`, `test:begin`, `test:end`, `run:end`) including attachments, steps, stdout/stderr, and error details.

## License

MIT
```

- [x] **Step 3: Verify build**

```bash
pnpm --filter @automate/reporter build
ls packages/reporter/dist/
# Should contain: index.js, index.cjs, index.d.ts
```

- [x] **Step 4: Commit**

```bash
git add packages/reporter/
git commit -m "feat: prepare @automate/reporter for npm publishing"
```

---

### Task 2.4: GitHub Actions — publish reporter to npm

**Files:**
- Create: `.github/workflows/publish-reporter.yml`

- [x] **Step 1: Create the workflow**

```yaml
name: Publish Reporter to npm

on:
  push:
    tags: ['reporter-v*']
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build reporter
        run: pnpm --filter @automate/reporter build

      - name: Publish
        run: pnpm --filter @automate/reporter publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [x] **Step 2: Commit**

```bash
git add .github/workflows/publish-reporter.yml
git commit -m "ci: add GitHub Actions workflow to publish @automate/reporter to npm"
```

---

### Task 2.5: Single `docker run` command — test end-to-end

**Files:** None (verification only)

- [x] **Step 1: Build the image locally**

```bash
docker build -t automate:v1 .
```

- [x] **Step 2: Run with a single command**

```bash
docker run -d \
  --name automate \
  -p 4000:4000 \
  -p 4001:4001 \
  -v automate_dashboard_data:/app/apps/server/data \
  -v automate_dashboard_artifacts:/app/apps/server/test-results \
  automate:v1
```

- [x] **Step 3: Verify health**

```bash
curl http://localhost:4000/health/live
# Expected: {"status":"ok","ts":...}

curl http://localhost:4000/health/ready
# Expected: {"status":"ok","db":"connected","ts":...}
```

- [x] **Step 4: Verify reporter connection**

From a separate project with Playwright:

```bash
npm install -D @automate/reporter
AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test
```

Verify results appear in the dashboard at `http://localhost:4000`.

- [x] **Step 5: Cleanup**

```bash
docker stop automate && docker rm automate
```

---

### Task 2.6: Add `docker run` to README Quick Start

**Files:**
- Modify: `README.md`

- [x] **Step 1: Verify the docker run command in README**

The README from Task 1.2 already includes `docker run`. Verify the exact command matches what was tested in Task 2.5. Update if needed.

- [x] **Step 2: Commit (if changed)**

```bash
git add README.md
git commit -m "docs: update docker run command with verified flags"
```

---

### Task 2.7: Version bump to 1.0.0

**Files:**
- Modify: `package.json`
- Modify: `packages/reporter/package.json`

- [x] **Step 1: Bump versions**

In root `package.json`, add `"version": "1.0.0"`.
In `packages/reporter/package.json`, bump to `"version": "1.0.0"`.

- [x] **Step 2: Commit**

```bash
git add package.json packages/reporter/package.json
git commit -m "chore: bump version to 1.0.0"
```

---

### Task 2.8: Sprint 2 verification

- [x] **Step 1: Full test suite**

```bash
pnpm --filter @automate/dashboard-server test && pnpm --filter @automate/dashboard-client test && pnpm typecheck
```

- [x] **Step 2: Docker build succeeds**

```bash
docker build -t automate:v1 .
```

- [x] **Step 3: Update progress dashboard**

Update Sprint 2 to `100%` and `(8/8 tasks)`.

---

## Chunk 4: Sprint 3 — Docs Site

> **Sprint Goal:** Launch a proper documentation site using Astro Starlight. Moves detailed content out of README.
>
> **Depends on:** Sprint 1 (README links to docs site).

### Task 3.1: Initialize Starlight docs site

**Files:**
- Create: `docs-site/` directory (Starlight project)

- [x] **Step 1: Create Starlight project**

```bash
cd "C:\VScode\QA\QA Dashboard"
pnpm create astro@latest docs-site -- --template starlight --no-install
```

Or manually create the structure:

```
docs-site/
├── astro.config.mjs
├── package.json
├── src/
│   └── content/
│       └── docs/
│           ├── index.mdx          # Landing/hero page
│           ├── getting-started.md  # Quick start guide
│           ├── deployment.md       # Docker, VPS, Railway
│           ├── configuration.md    # Env vars, feature flags
│           ├── reporter.md         # @automate/reporter setup
│           ├── features.md         # Full feature list with flags
│           ├── architecture.md     # Technical architecture
│           └── api.md              # REST API reference
└── tsconfig.json
```

- [x] **Step 2: Configure Starlight**

`docs-site/astro.config.mjs`:

```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Automate',
      description: 'Self-hosted Playwright QA Dashboard',
      social: {
        github: 'https://github.com/YOUR_USERNAME/automate',
      },
      sidebar: [
        { label: 'Getting Started', link: '/getting-started/' },
        { label: 'Reporter Setup', link: '/reporter/' },
        { label: 'Deployment', link: '/deployment/' },
        { label: 'Configuration', link: '/configuration/' },
        { label: 'Features', link: '/features/' },
        { label: 'Architecture', link: '/architecture/' },
        { label: 'API Reference', link: '/api/' },
      ],
    }),
  ],
});
```

- [x] **Step 3: Install and verify**

```bash
cd docs-site
pnpm install
pnpm dev
# Verify at http://localhost:4321
```

- [x] **Step 4: Commit**

```bash
git add docs-site/
git commit -m "feat: initialize Starlight docs site"
```

---

### Task 3.2: Write Getting Started page

**Files:**
- Create: `docs-site/src/content/docs/getting-started.md`

Content should cover:
1. Prerequisites (Docker OR Node.js 22)
2. Docker quick start (single command)
3. Connect your tests (install reporter, add to config, run)
4. Verify results appear
5. Next steps links

Target: ~80 lines. Step-by-step with code blocks.

- [x] **Step 1: Write the content**

- [x] **Step 2: Verify it renders**

```bash
cd docs-site && pnpm dev
```

Navigate to the getting started page and verify formatting.

- [x] **Step 3: Commit**

```bash
git add docs-site/src/content/docs/getting-started.md
git commit -m "docs: add Getting Started guide"
```

---

### Task 3.3: Write Deployment guide

**Files:**
- Create: `docs-site/src/content/docs/deployment.md`

Migrate and improve content from `docs/DEPLOYMENT.md` (246 lines). Sections:
1. Docker (single command)
2. Docker Compose (with nginx)
3. VPS (systemd unit)
4. Railway / Render (PaaS)
5. Volumes and data persistence
6. Reverse proxy (nginx config)
7. HTTPS / TLS

- [x] **Step 1: Write the content**

- [x] **Step 2: Commit**

```bash
git add docs-site/src/content/docs/deployment.md
git commit -m "docs: add Deployment guide"
```

---

### Task 3.4: Write Configuration and Features pages

**Files:**
- Create: `docs-site/src/content/docs/configuration.md`
- Create: `docs-site/src/content/docs/features.md`

**Configuration page:**
- All environment variables with descriptions
- Feature flags table (flag name, default, what it enables)
- Example `.env` file

**Features page:**
- Full feature table (moved from old README)
- Each feature with screenshot + description
- Which features require flags

- [x] **Step 1: Write both pages**

- [x] **Step 2: Commit**

```bash
git add docs-site/src/content/docs/configuration.md docs-site/src/content/docs/features.md
git commit -m "docs: add Configuration and Features reference pages"
```

---

### Task 3.5: Write Reporter and Architecture pages

**Files:**
- Create: `docs-site/src/content/docs/reporter.md`
- Create: `docs-site/src/content/docs/architecture.md`

**Reporter page:**
- Install and configure @automate/reporter
- AUTOMATE_DASHBOARD_URL env var
- CI setup (GitHub Actions, GitLab CI)
- Options reference
- Troubleshooting

**Architecture page:**
- Migrate from `docs/ARCHITECTURE-DECISIONS.md`
- Two-port WebSocket diagram
- Data flow: reporter → bridge → SQLite → browser
- Tech stack with rationale

- [x] **Step 1: Write both pages**

- [x] **Step 2: Commit**

```bash
git add docs-site/src/content/docs/reporter.md docs-site/src/content/docs/architecture.md
git commit -m "docs: add Reporter setup and Architecture pages"
```

---

### Task 3.6: Sprint 3 verification

- [x] **Step 1: Build docs site**

```bash
cd docs-site && pnpm build
```

Expected: Build succeeds, static output in `docs-site/dist/`.

- [x] **Step 2: Verify all pages render**

Run `pnpm preview` and check every page in the sidebar.

- [x] **Step 3: Update progress dashboard**

Update Sprint 3 to `100%` and `(6/6 tasks)`.

---

## Chunk 5: Sprint 4 — Failure Analysis Polish

> **Sprint Goal:** Make the core failure analysis flow (the v1 differentiator) buttery smooth.
>
> **Depends on:** Sprint 0 (feature flags to hide non-core features).

### Task 4.1: Audit TestDetail component for UX issues

**Files:**
- Analyze: `apps/client/src/components/tests/TestDetail.tsx` (297 lines, 10 tabs)

- [ ] **Step 1: Review TestDetail and identify UX issues**

Read `apps/client/src/components/tests/TestDetail.tsx` and list:
1. Tab overload — 10 tabs is too many for v1. With feature flags, hide: AI Explain, Impact Analysis, Known Failures
2. Tab ordering — failure-relevant tabs should be first: Error → Steps → Screenshots → Video → Trace → History → Console → Source
3. Loading states — do all tabs have loading indicators?
4. Empty states — what happens when there's no screenshot, no video, no trace?

Document findings and proposed order.

- [ ] **Step 2: Reorder tabs and hide flagged ones**

Reorder tabs to prioritize failure analysis flow. Wrap non-core tabs with `<FeatureGate>`.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @automate/dashboard-client test
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/tests/TestDetail.tsx
git commit -m "feat: reorder TestDetail tabs for failure-first UX, hide v2 tabs behind flags"
```

---

### Task 4.2: Improve screenshot diff UX

**Files:**
- Modify: `apps/client/src/components/artifacts/ScreenshotDiff.tsx` (59 lines)

- [ ] **Step 1: Review and improve**

The current ScreenshotDiff is 59 lines — likely very basic. Improvements:
1. Add side-by-side mode (not just slider)
2. Add zoom on click
3. Add "highlight differences" overlay
4. Better loading state

- [ ] **Step 2: Implement improvements**

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/artifacts/ScreenshotDiff.tsx
git commit -m "feat: improve screenshot diff with side-by-side and zoom"
```

---

### Task 4.3: Improve error display in results

**Files:**
- Analyze and improve error message rendering across test result views

- [ ] **Step 1: Audit error display**

Check how `errorMessage` and `errorStack` are rendered. Common issues:
1. Stack traces not syntax-highlighted
2. Long error messages not wrapped
3. No "copy error" button
4. No link to source file

- [ ] **Step 2: Implement improvements**

Add:
- Monospace font for stack traces
- Syntax highlighting for code in stack traces (at minimum, file paths clickable)
- Copy button for error message
- Collapsible full stack trace

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: improve error display with syntax highlighting and copy button"
```

---

### Task 4.4: Add empty states to artifact viewers

**Files:**
- Modify: `apps/client/src/components/artifacts/TraceViewer.tsx`
- Modify: `apps/client/src/components/artifacts/ScreenshotDiff.tsx`
- Modify: `apps/client/src/components/artifacts/VideoPlayer.tsx`

- [ ] **Step 1: Add empty states**

When no artifact is available, show a helpful message instead of a blank panel:
- TraceViewer: "No trace recorded. Enable tracing in playwright.config.ts: `use: { trace: 'on-first-retry' }`"
- ScreenshotDiff: "No screenshots captured. Enable screenshots: `use: { screenshot: 'only-on-failure' }`"
- VideoPlayer: "No video recorded. Enable video: `use: { video: 'on-first-retry' }`"

Include a link to Playwright docs for each.

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/components/artifacts/
git commit -m "feat: add helpful empty states to artifact viewers with Playwright config hints"
```

---

### Task 4.5: Sprint 4 verification

- [ ] **Step 1: Full test suite**

```bash
pnpm --filter @automate/dashboard-server test && pnpm --filter @automate/dashboard-client test && pnpm typecheck
```

- [ ] **Step 2: Manual test failure analysis flow**

1. Run Playwright tests with intentional failures
2. Open a failed test in the dashboard
3. Verify tab order makes sense
4. Verify screenshot diff works
5. Verify error display is readable
6. Verify empty states show when artifacts are missing

- [ ] **Step 3: Update progress dashboard**

Update Sprint 4 to `100%` and `(5/5 tasks)`.

---

## Chunk 6: Sprint 5 — Community & Launch

> **Sprint Goal:** Add community signals (CONTRIBUTING, CHANGELOG, issue templates) and prepare for public launch.
>
> **Depends on:** All previous sprints.

### Task 5.1: Create CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [x] **Step 1: Write CONTRIBUTING.md**

Sections:
1. Development setup (prerequisites, install, dev server)
2. Project structure overview
3. Code conventions (existing patterns to follow)
4. Testing requirements (must pass, coverage expectations)
5. PR process
6. Issue reporting guidelines

Target: ~80 lines.

- [x] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md"
```

---

### Task 5.2: Create CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [x] **Step 1: Write initial changelog**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-XX-XX

### Added
- Real-time test monitoring via WebSocket
- Failure analysis: screenshot diffs, video playback, trace viewer, step timeline
- Analytics dashboard: pass-rate trends, duration charts, flaky leaderboard
- Test explorer with groupable tree view
- Run comparison (side-by-side diff)
- Integration hooks: Slack, Jira, GitHub
- Quality gates with configurable thresholds
- Docker single-command deployment
- `@automate/reporter` npm package for Playwright
- Feature flag system for progressive feature enablement
- Documentation site (Starlight)
- Zero-question onboarding wizard
- `Automate init` setup command

### Changed
- node-pty made optional (behind `FEATURE_TERMINAL_RUNNER` flag)
- Docker image no longer requires build tools in production

### Removed
- Interactive CLI prompts (replaced with zero-question flow)
```

- [x] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md for v1.0.0"
```

---

### Task 5.3: Create GitHub issue templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`

- [x] **Step 1: Create bug report template**

```markdown
---
name: Bug Report
about: Report a bug in Automate
labels: bug
---

## Description

A clear description of the bug.

## Steps to Reproduce

1. ...
2. ...

## Expected Behavior

What should happen.

## Actual Behavior

What actually happens.

## Environment

- Automate version:
- Docker/Node.js:
- OS:
- Browser:
```

- [x] **Step 2: Create feature request template**

```markdown
---
name: Feature Request
about: Suggest an enhancement
labels: enhancement
---

## Problem

What problem does this solve?

## Proposed Solution

How should it work?

## Alternatives Considered

Any other approaches?
```

- [x] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE/
git commit -m "chore: add GitHub issue templates"
```

---

### Task 5.4: Create PR template

**Files:**
- Create: `.github/pull_request_template.md`

- [x] **Step 1: Create template**

```markdown
## Summary

What does this PR do?

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Enhancement
- [ ] Documentation
- [ ] Refactor

## Testing

- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] All existing tests pass

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] No `as any` or `@ts-ignore`
```

- [x] **Step 2: Commit**

```bash
git add .github/pull_request_template.md
git commit -m "chore: add PR template"
```

---

### Task 5.5: Final polish pass

- [x] **Step 1: Search for remaining TODOs**

```bash
grep -r "TODO" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" .
```

Triage each: fix, remove, or document as known limitation.

- [x] **Step 2: Run lint**

```bash
pnpm lint
```

Fix any lint errors.

- [x] **Step 3: Run full test suite one final time**

```bash
pnpm --filter @automate/dashboard-server test
pnpm --filter @automate/dashboard-client test
pnpm typecheck
pnpm lint
```

All must pass.

- [x] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: final polish — fix remaining TODOs and lint errors"
```

---

### Task 5.6: Sprint 5 verification + launch checklist

- [x] **Step 1: Pre-launch checklist**

Verify each:
- [x] `docker run` command works from zero
- [x] `npm install -D @automate/reporter` works (after npm publish)
- [x] Dashboard loads and shows onboarding
- [x] Connecting Playwright to reporter works
- [x] Results stream in real-time
- [x] Failure analysis flow is smooth (error → screenshots → video → trace)
- [x] Analytics page has data after runs
- [x] README renders correctly on GitHub
- [x] Docs site builds and all pages work
- [x] No v2 features visible with default flags
- [x] CONTRIBUTING.md and CHANGELOG.md present
- [x] Issue templates work
- [x] CI workflows defined (Docker publish, npm publish)

- [x] **Step 2: Update progress dashboard**

Update Sprint 5 to `100%` and `(6/6 tasks)`. Update overall to `100%` and `(40/40 tasks)`.

- [x] **Step 3: Tag v1.0.0**

```bash
git tag -a v1.0.0 -m "Automate v1.0.0 — adoption-ready release"
git tag -a reporter-v1.0.0 -m "@automate/reporter v1.0.0"
git push origin v1.0.0 reporter-v1.0.0
```

---

## Execution Notes

### Running Order

Sprints are designed to be executed in order (0→1→2→3→4→5) because of dependencies. However, within each sprint, tasks can often be parallelized:

- **Sprint 0:** Tasks 0.1–0.4 are sequential (each builds on prior). Tasks 0.5–0.6 can run in parallel after 0.4. Task 0.7 is independent.
- **Sprint 1:** Tasks 1.1 and 1.2 are parallel-safe. Task 1.3–1.4 are independent of each other.
- **Sprint 2:** Tasks 2.1–2.4 can all run in parallel. Task 2.5 depends on 2.1.
- **Sprint 3:** Tasks 3.1 must be first. Tasks 3.2–3.5 can run in parallel after 3.1.
- **Sprint 4:** Tasks 4.1–4.4 can all run in parallel.
- **Sprint 5:** Tasks 5.1–5.4 can all run in parallel. Task 5.5 depends on all prior.

### Environment Requirements

- Node.js 22+
- pnpm 9+
- Docker (for Sprint 2 verification)
- A Playwright test project (for end-to-end reporter testing)

### Progress Update Convention

After completing each task, update the progress dashboard at the top of this file:
1. Calculate `(completed_tasks / total_tasks) * 100` for each sprint
2. Fill the progress bar: each `▓` = 5% (20 chars total)
3. Update the task count `(N/M tasks)`
4. Update the TOTAL row

Example after Sprint 0 complete:
```
Sprint 0 — Foundation (Feature Flags)         [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%  (8/8 tasks)
```
