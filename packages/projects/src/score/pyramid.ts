import { PYRAMID_LAYERS, type PyramidLayer } from '../vocabulary.js';

/**
 * The observed and target shapes of a test suite, and how far apart they are.
 *
 * ```
 * pyramid = 1 − min(1, ½ · ‖observed − target‖₁)
 * ```
 *
 * The L1 norm of a three-part share vector against another three-part share
 * vector is at most 2, so half of it is at most 1, and the shape therefore lands
 * in `[0,1]` with `0` meaning "exactly as inverted as a distribution of three
 * parts can be" and `1` meaning "on target".
 *
 * ## Reported as a shape, not a gate, by default
 *
 * A pyramid target is a heuristic borrowed from one blog post. A gate built on it
 * gets gamed by writing unit tests for their own sake — which raises the score
 * while lowering the value of the suite — so a project has to opt in before this
 * number blocks anything. The dashboard shows the drift over releases either way.
 */
export interface PyramidVerdict {
  /** The observed share of executed tests per layer. Sums to 1 when there are tests. */
  observed: Record<PyramidLayer, number>;
  /**
   * The target this verdict was measured against.
   *
   * **Defaults to `DEFAULT_PYRAMID_TARGET` so a chart always has something to draw
   * against** — and that is exactly why `declaredTarget` exists beside it. Without
   * the two, a project that never wrote a `targets.pyramid` is indistinguishable
   * from one that wrote our default, and a copilot asked "is my pyramid off?" would
   * answer about a target the team never chose.
   */
  target: Record<PyramidLayer, number>;
  /**
   * The target the project **itself** declared, or `null` when it declared none.
   *
   * This is the gate on every "your pyramid is inverted" suggestion. A pyramid
   * target is a heuristic from a blog post; a product that opens with it is opening
   * with an opinion the team did not ask for, and a team that did not ask for it has
   * no reason to read the rest of the answer.
   */
  declaredTarget: Record<PyramidLayer, number> | null;
  /** `[0,1]`. `1` is exactly on target. */
  shape: number;
  /** `‖observed − target‖₁`, so the panel can show how far and in which direction. */
  drift: number;
}

export const DEFAULT_PYRAMID_TARGET: Record<PyramidLayer, number> = {
  unit: 0.7,
  integration: 0.2,
  e2e: 0.1,
};

/**
 * `pyramid = 1 − min(1, ½ · ‖observed − target‖₁)`.
 *
 * With **no executed tests at all** the observed vector is undefined, and the
 * honest shape is `0` rather than "on target because nothing deviates". A suite
 * with nothing in it happens to have no drift; saying it is perfectly balanced
 * would be the same arithmetic laundered into a compliment.
 */
export function pyramidShape(
  executedPerLayer: Readonly<Record<PyramidLayer, number>>,
  declared?: Readonly<Record<PyramidLayer, number>>,
): PyramidVerdict {
  const target = declared ?? DEFAULT_PYRAMID_TARGET;
  const total = PYRAMID_LAYERS.reduce((sum, layer) => sum + (executedPerLayer[layer] ?? 0), 0);
  if (total === 0) {
    return {
      observed: { ...target },
      target: { ...target },
      // `null` when the project declared none, **not** the default. A project with
      // no declared target has drifted from nothing, and reporting a drift against
      // a target it never chose is the same unsolicited opinion the copilot exists
      // to withhold.
      declaredTarget: declared === undefined ? null : { ...target },
      shape: 0,
      drift: 1,
    };
  }
  const observed = {
    unit: (executedPerLayer.unit ?? 0) / total,
    integration: (executedPerLayer.integration ?? 0) / total,
    e2e: (executedPerLayer.e2e ?? 0) / total,
  };
  const drift = PYRAMID_LAYERS.reduce(
    (sum, layer) => sum + Math.abs(observed[layer] - (target[layer] ?? 0)),
    0,
  );
  return {
    observed,
    target: { ...target },
    declaredTarget: declared === undefined ? null : { ...target },
    shape: 1 - Math.min(1, 0.5 * drift),
    drift,
  };
}

/** True when the shares sum to 1 to within rounding, which is the score's own invariant. */
export function isPyramidBalanced(vector: Readonly<Record<PyramidLayer, number>>): boolean {
  const total = PYRAMID_LAYERS.reduce((sum, layer) => sum + (vector[layer] ?? 0), 0);
  return Math.abs(total - 1) < 1e-9;
}
