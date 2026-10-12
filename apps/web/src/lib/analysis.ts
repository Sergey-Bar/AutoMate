import {
  CATEGORY_LABELS,
  ESSENTIAL_TOOL_IDS,
  groupByCategory,
  type QATool,
  type QAToolCategory,
} from '@automate/projects/tool-catalog';

/**
 * The stack analysis: what the repository says a stack is, and what that number
 * means.
 *
 * ## The registry moved to the package; the arithmetic stayed here
 *
 * The fifty tools come from `@automate/projects/tool-catalog` now, so the API
 * and the browser read one list. What lives here is the part that is about
 * *this repository*: joining a detection against the registry, counting the
 * coverage, and grouping for the screen. The registry answers "what tools
 * exist"; this module answers "what does this project have".
 */

export { CATEGORY_LABELS, ESSENTIAL_TOOL_IDS, groupByCategory };
export type { QATool, QAToolCategory };

/**
 * Which tier a tool sits in, and how its badge reads.
 *
 * `paid` is a warning and not a neutral badge because the install line is not
 * the whole cost of a paid tool — a reader has to know that before installing
 * it, not after.
 */
export const TIER_LABELS = {
  free: 'Free',
  paid: 'Paid',
  freemium: 'Freemium',
} as const;

export const TIER_VARIANT = {
  free: 'success',
  paid: 'warning',
  freemium: 'default',
} as const;

/**
 * One tool's detected state, as a reader is told about it.
 *
 * `evidence` is the pattern or the file that proved presence, so the claim can
 * be checked; `version` is best-effort and nullable because an installed tool
 * that declines to answer `--version` is still installed.
 */
export interface ToolDetection {
  toolId: string;
  detected: boolean;
  evidence: string | null;
  version?: string | null;
}

/** The detected state of one tool. */
export interface ToolStatus {
  tool: QATool;
  detected: boolean;
  evidence: string | null;
}

/**
 * Join the registry against a detection, per tool.
 *
 * **A missing detection row means undetected, and that is the whole rule.** The
 * probe answers for the tools it checked; a tool it never mentioned is a tool it
 * did not find, and inventing `detected: false` with fabricated evidence would
 * be worse than saying so — the coverage figure is computed from this join, so
 * a row the caller forgot becomes a tool the stack is missing.
 */
export function analyzeStack(
  tools: readonly QATool[],
  detections: readonly ToolDetection[],
): { statuses: ToolStatus[]; coverage: number } {
  const byTool = new Map(detections.map((detection) => [detection.toolId, detection]));
  const statuses: ToolStatus[] = tools.map((tool) => {
    const detection = byTool.get(tool.id);
    return {
      tool,
      detected: detection?.detected ?? false,
      evidence: detection?.evidence ?? null,
    };
  });
  const detectedCount = statuses.filter((status) => status.detected).length;
  const coverage = tools.length === 0 ? 0 : Math.round((detectedCount / tools.length) * 100);
  return { statuses, coverage };
}
