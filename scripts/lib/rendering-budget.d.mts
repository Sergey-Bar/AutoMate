/**
 * Types for `rendering-budget.mjs`, so its consumer in `e2e/` is checked rather than
 * implicitly `any`.
 *
 * The comparison is a pure function over two JSON documents, and the browser half of
 * the rendering gate is TypeScript. Without this, `auditRenderingBudget` would arrive
 * in the spec as `any` — the one place where a wrong shape would silently produce a
 * measurement of nothing and pass.
 */

export interface RenderMetricDefinition {
  /** The key this metric occupies in a route's reading and in a route's ceiling. */
  key: 'lcpMs' | 'inpMs' | 'cls' | 'longTasks';
  /** The name a reader recognises, used in every failure message. */
  label: string;
  /** `''` for a unitless ratio, so the message can never print `0.31ms`. */
  unit: string;
  /** What the metric is, so a finding explains itself without a second lookup. */
  why: string;
}

export declare const METRICS: readonly RenderMetricDefinition[];

export declare function measurementProblems(route: string, reading: unknown): string[];

export declare function auditRenderingBudget(
  baseline: unknown,
  measurement: unknown,
): { findings: string[]; routes: number };
