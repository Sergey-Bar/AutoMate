import { z } from 'zod/v4';

/**
 * The report format vocabulary — **one table, read by everything that names a format.**
 *
 * ## Why this file exists
 *
 * Four places spelled the same set of formats and disagreed about it:
 *
 *   - `apps/api/src/routes/reporter.ts` — `declaredFormat()` knew `junit`, `playwright`
 *     and nothing else, so a k6 summary reached the Playwright adapter and a ZAP report
 *     reached the **JUnit** one, which then answered "JUnit report contains no test
 *     cases" about a security scan;
 *   - `apps/runner/src/generic-spawn.ts` — `artifactKind()` labelled the runner's own
 *     artifacts `junit` and `k6-json`, two of them canonical and one not;
 *   - `apps/runner/src/execution.ts` — a second `artifactKind()`, labelling Playwright
 *     `playwright-json` and JUnit `junit`, in the same package;
 *   - `packages/projects/src/detect/types.ts` — `RESULT_FORMATS`, a fourth spelling that
 *     had to be edited in step with the other three or silently disagree.
 *
 * Each list was correct about the formats it had been written for and blind to the ones
 * added since, which is what a hand-maintained vocabulary does: it does not fail, it
 * quietly routes a real report to a parser that cannot read it.
 *
 * ## What this table decides, and what it deliberately does not
 *
 * It owns the **vocabulary**: the canonical id, the producer a result is attributed to,
 * the document encoding, the spellings callers use, and whether the format is one a
 * project scan can detect. It does **not** own parsing — `@automate/reporter` owns the
 * adapters and maps an id onto one. The dependency runs leaf-ward for that reason: this
 * package is imported by the reporter, not the other way round.
 */

/**
 * Every producer a canonical result can be attributed to.
 *
 * A **producer** is who wrote the document; a **format** is the shape they wrote it in.
 * They are different questions and the table below maps one onto the other. `robot`,
 * `sarif` and `otel` are producers with no ingestible format here — SARIF export is not
 * built (capability register, `tool.zap`) and OTLP is not a test report at all — and
 * `generic` exists for a result whose writer could not be named. Naming them here rather
 * than omitting them is what makes their absence a decision rather than a gap.
 */
export const REPORT_PRODUCERS = [
  'playwright',
  'junit',
  'robot',
  'k6',
  'zap',
  'sarif',
  'otel',
  'generic',
  'legacy',
] as const;

export const ReportProducerSchema = z.enum(REPORT_PRODUCERS);
export type ReportProducer = z.infer<typeof ReportProducerSchema>;

/** How a format's bytes are encoded, which is what a mislabelled upload is caught on. */
export const REPORT_ENCODINGS = ['json', 'xml'] as const;

/**
 * One ingestible format.
 *
 * `spellings` are the values a caller may send in `format=` or `artifactType=`. More than
 * one per format because more than one is in the wild and **none of them is wrong**: they
 * are two field names for one piece of information, and a door that refused a spelling
 * would reject a real report with a message about the wrong thing. `xml` is listed under
 * JUnit for the same reason, and it is genuinely ambiguous — which is why the door says
 * so rather than guessing when a document declares nothing.
 *
 * `detectable` marks the formats `packages/projects` recognises as a project's own
 * output. It is false for Playwright, which that scanner does not walk for, and for the
 * legacy upload, which is a wire shape rather than a file. Deriving `RESULT_FORMATS` from
 * this flag is what stops the two lists drifting.
 */
export const REPORT_FORMATS = [
  {
    id: 'junit-xml',
    producer: 'junit',
    encoding: 'xml',
    spellings: ['junit', 'junit-xml', 'xml'],
    detectable: true,
  },
  {
    id: 'playwright-json',
    producer: 'playwright',
    encoding: 'json',
    spellings: ['playwright', 'playwright-json'],
    detectable: false,
  },
  {
    id: 'k6-json',
    producer: 'k6',
    encoding: 'json',
    spellings: ['k6', 'k6-json', 'k6-summary'],
    detectable: true,
  },
  {
    id: 'zap-xml',
    producer: 'zap',
    encoding: 'xml',
    spellings: ['zap', 'zap-xml'],
    detectable: true,
  },
  { id: 'legacy-upload', producer: 'legacy', encoding: 'json', spellings: [], detectable: false },
] as const;

export type ReportFormatId = (typeof REPORT_FORMATS)[number]['id'];
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportEncoding = (typeof REPORT_ENCODINGS)[number];

export const ReportFormatIdSchema = z.enum(
  REPORT_FORMATS.map((format) => format.id) as [ReportFormatId, ...ReportFormatId[]],
);

/** Every canonical id, in the table's order. */
export const REPORT_FORMAT_IDS: readonly ReportFormatId[] = REPORT_FORMATS.map(
  (format) => format.id,
);

/**
 * The formats a project scan can detect — the source `packages/projects`' `RESULT_FORMATS`
 * is derived from, so the two cannot disagree.
 */
export const DETECTABLE_REPORT_FORMAT_IDS: readonly ReportFormatId[] = REPORT_FORMATS.filter(
  (format) => format.detectable,
).map((format) => format.id);

/** @param id @returns the row, or `undefined` for an id this build does not read. */
export function reportFormatById(id: string): ReportFormat | undefined {
  return REPORT_FORMATS.find((format) => format.id === id);
}

/**
 * The format a declared spelling names, or `undefined` when the caller declared nothing
 * this build recognises.
 *
 * `undefined` and `''` are the same answer on purpose: a door that treated an
 * unrecognised spelling as a *refusal* would break every caller who sends a format added
 * by a newer producer, and one that treated it as a match would route it anywhere. The
 * caller falls back to the filename and then the content, and says which it used.
 *
 * @param spelling lower-cased, trimmed
 */
export function reportFormatForSpelling(spelling: string): ReportFormat | undefined {
  const wanted = spelling.trim().toLowerCase();
  return REPORT_FORMATS.find((format) => format.spellings.some((known) => known === wanted));
}
