import { createHash } from 'node:crypto';
import type { CanonicalFinding, FindingSeverity } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES, MAX_SARIF_RESULTS } from './sarif.js';
import { type Json, record, text } from './json-fields.js';

/**
 * SkillSpector (`skillspector scan <dir> --format json`) → canonical findings.
 *
 * ## The shape is the one this repository has actually seen
 *
 * `scripts/skill-scan.mjs` reads the report skillspector 2.12.0 wrote on 2026-10-02:
 * `risk_assessment.{recommendation,score}`, `analysis_completeness`, and `issues[]`, each with
 * `id` (the rule, e.g. `MP3`), `severity` (`HIGH`, `MEDIUM`, …), `finding` (the matched text),
 * `match_fingerprint`, a per-run `finding_id`, and `location.{file,start_line}`. Only `issues`
 * becomes findings. The aggregate verdict is deliberately not turned into one: it is derived
 * from the issues, and the gate's own experience is that a tree of reviewed false positives
 * keeps returning `DO_NOT_INSTALL` for ever.
 *
 * ## Identity is `match_fingerprint`, never `finding_id`
 *
 * Two scans of the same tree on the same day produced different `finding_id` values for
 * identical findings (AGENTS.md; `docs/quality/skill-findings-baseline.json`), so keying on it
 * would make every finding "new" on every scan. `match_fingerprint` is the content address and
 * was byte-identical across runs. It is combined with the file, because the baseline also
 * shows one fingerprint reported in two files ("one pattern matched in two files"); keyed on
 * the fingerprint alone, the second location would silently disappear from the findings
 * table. A finding without a `match_fingerprint` falls back to rule, file and the normalised
 * matched text — still never the run-scoped id, and never the line.
 *
 * ## Everything lands in `ai-governance`
 *
 * SkillSpector judges the instructions an agent obeys, which is what that dimension measures.
 * Its rules carry no CWE or CVSS, so every finding is an `issue`; a skill's leaked token is
 * gitleaks' to report as a `secret`, with the evidence a hard gate needs.
 */
export const SKILLSPECTOR_ADAPTER_VERSION = '1';

const TOOL = 'skillspector';

const SEVERITY: Readonly<Record<string, FindingSeverity>> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

/** An unrecognised severity is `medium`, as SARIF's default level is: neither hidden nor inflated. */
function severityOf(value: unknown): FindingSeverity {
  return (typeof value === 'string' ? SEVERITY[value.toLowerCase()] : undefined) ?? 'medium';
}

function decode(input: Uint8Array): unknown[] {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `SkillSpector report is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', 'SkillSpector report is not valid JSON');
  }
  const issues = record(parsed)?.['issues'];
  // No `issues` array is not "no findings": it is not a SkillSpector report, and ingesting it
  // as one would record a clean scan nobody ran.
  if (!Array.isArray(issues)) {
    throw new HealthReportError('malformed', 'SkillSpector report has no issues array');
  }
  // Refused rather than truncated, as for SARIF: a partial scan reads as clean.
  if (issues.length > MAX_SARIF_RESULTS) {
    throw new HealthReportError(
      'too_large',
      `SkillSpector report has more than ${String(MAX_SARIF_RESULTS)} issues`,
    );
  }
  return issues;
}

/** Paths are relative to the scanned directory; only the separators are normalised. */
function pathOf(location: Json | null): string | null {
  const file = text(location?.['file']);
  return file === null ? null : file.replace(/\\/gu, '/').replace(/^\.\//u, '').slice(0, 1000);
}

function lineOf(location: Json | null): number | null {
  const line = location?.['start_line'];
  return typeof line === 'number' && Number.isInteger(line) && line >= 1 ? line : null;
}

function messageOf(ruleId: string, issue: Json): string {
  const described = text(issue['description']) ?? text(issue['title']) ?? text(issue['message']);
  const matched = text(issue['finding']);
  const sentence =
    described === null ? null : /[.!?]$/u.test(described) ? described : `${described}.`;
  if (sentence !== null && matched !== null) return `${ruleId}: ${sentence} Matched "${matched}".`;
  if (sentence !== null) return `${ruleId}: ${sentence}`;
  if (matched !== null) return `${ruleId}: matched "${matched}".`;
  return `${ruleId}: reported by skillspector.`;
}

function fingerprintOf(ruleId: string, issue: Json, path: string | null): string {
  const hash = createHash('sha256').update(`${TOOL}\u0000`);
  const content = text(issue['match_fingerprint']);
  if (content !== null) return hash.update(`${content}\u0000${path ?? ''}`).digest('hex');
  const matched = (text(issue['finding']) ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
  return hash.update(`${ruleId}\u0000${path ?? ''}\u0000${matched}`).digest('hex');
}

/** Parse a SkillSpector JSON report. Throws `HealthReportError` on a document that is not one. */
export function parseSkillSpector(input: Uint8Array): CanonicalFinding[] {
  const findings = new Map<string, CanonicalFinding>();
  for (const raw of decode(input)) {
    const issue = record(raw);
    if (issue === null) continue;
    const ruleId = (text(issue['id']) ?? 'unknown').slice(0, 300);
    const location = record(issue['location']);
    const path = pathOf(location);
    const fingerprint = fingerprintOf(ruleId, issue, path);
    if (findings.has(fingerprint)) continue;
    findings.set(fingerprint, {
      fingerprint,
      tool: TOOL,
      ruleId,
      kind: 'issue',
      severity: severityOf(issue['severity']),
      dimension: 'ai-governance',
      path,
      line: lineOf(location),
      message: messageOf(ruleId, issue).slice(0, 4000),
      helpUri: null,
      fixAvailable: null,
    });
  }
  return [...findings.values()];
}
