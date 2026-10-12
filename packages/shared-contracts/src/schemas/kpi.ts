import { z } from 'zod/v4';

/**
 * A KPI, as the server states it and the client is allowed to show it.
 *
 * ## Why `unit` is a field and not a convention
 *
 * This is GLASS-3, and it is the shape of a defect a codebase pays for twice. The
 * analytics summary sends `passRate` as **0–100** while `surfaceCoverage` and
 * `flakeRate` are **0–1 ratios**, so a client has to *know* which kind of number it
 * was handed before it can print a percent sign — and two formatters exist in the
 * web app for exactly that, with the choice made at each call site by a human who
 * remembered. A number that arrives with two bare values then prints `0.5%`, which
 * is a claim nobody made and which reads as true.
 *
 * The unit travels with the number now, so the choice is made once, by whoever
 * computed it, and a screen formats from the declaration rather than from memory.
 * `percent` and `ratio` are different units and not different scales of one: a
 * 0.5 ratio is a 50 percent, and the two spellings are the whole content of the
 * bug.
 */
export const KPI_UNITS = ['percent', 'ratio', 'duration_ms', 'count', 'text'] as const;

export const KpiSchema = z.object({
  /** Stable id, so a client can find a KPI without matching on its label. */
  id: z.string().min(1),
  label: z.string().min(1),
  /**
   * The number, or `null` when nothing was measured.
   *
   * **`null`, and never `0`.** "No duration was ever recorded" and "the average
   * duration was zero" are different statements about a suite, and the second one
   * is never true of a run that took time.
   */
  value: z.number().nullable(),
  unit: z.enum(KPI_UNITS),
  /**
   * What the number was computed over, when it is a rate.
   *
   * A rate without its denominator is a percentage of nothing: 91% passed out of
   * twelve runs and out of three are different stories about a suite, and a reader
   * can only tell them apart if the denominator travelled too.
   */
  denominator: z.number().nullable().default(null),
  /** The sentence that explains the number, when it needs one. */
  qualifier: z.string().nullable().default(null),
});

export type Kpi = z.infer<typeof KpiSchema>;

/**
 * The install's KPIs, and the units they were computed in.
 *
 * Install-wide, deliberately. The score's limiter and its flake rate are
 * **per-project** numbers — one install with two projects has no single limiter, and
 * averaging two caps would be a number nobody can act on. Those live on the score
 * response, which has always carried them, and this endpoint leaves them there
 * rather than pretending to know which project a reader meant.
 */
export const KpiSummarySchema = z.object({
  kpis: z.array(KpiSchema),
});

export type KpiSummary = z.infer<typeof KpiSummarySchema>;
