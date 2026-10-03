#!/usr/bin/env node
/**
 * skill-scan.mjs — scan the repository's own agent skills before trusting them.
 *
 * A skill is instructions the agent executes with implicit trust, so it is
 * supply-chain input. NVIDIA's own research over a 31,132-skill dataset found
 * **26.1% of skills contain vulnerabilities and 5.2% show likely malicious
 * intent**. The four vendored skills in `.kilo/skills/` carry an upstream
 * provenance record in `skills-lock.json` (source repository and content hash),
 * but a hash answers "did the file change" and not "is the file safe" — so the
 * content is scanned as well as versioned.
 *
 * ## Why this exists rather than being folded into `security:secrets`
 *
 * `security:secrets` scans the repository. Nothing scanned the *instructions*.
 * AGENTS.md, the eleven personas in `.kilo/agent/`, and every `SKILL.md` are
 * text the agent obeys; a repository that has audited its secrets, its
 * dependencies, and its licenses has not thereby audited the prompt surface.
 * That is a gap of the same shape as `P-6`'s three startup-policy authorities:
 * a trust boundary that exists in the product and nowhere in the gates.
 *
 * ## The unavailable-tool policy is `host-scanners.mjs`, not this file
 *
 * An unrun scan is not a pass, but a developer who cannot run it is worse off
 * than one who can. So the same narrow boundary that governs `semgrep` and
 * `gitleaks` governs this: `AUTOMATE_HOST_SCANNERS=unavailable` records
 * `not_configured` and exits 0, and no file under `.github/` may set it — a
 * scanner that *ran* and reported something still fails either way, and a
 * scanner killed at the ceiling counts as unavailable rather than clean.
 *
 * The policy is imported rather than restated, which is the whole point of that
 * module existing: a second unavailable-tool rule would be a second authority,
 * and this repository has already recorded three of those.
 *
 * ## Tier: `pr-reporting`, and deliberately not in `verify`
 *
 * **The scan has now run, and what it returned is the reason for the tier.**
 * On 2026-10-02, skillspector 2.12.0 scanned the eight skills and returned
 * `DO_NOT_INSTALL` at risk score 56 — on the strength of six pattern matches
 * against markdown prose: a React README sentence reading "Define clear context
 * interfaces", a `dangerouslySetInnerHTML` inside a fenced code block in
 * Vercel's own hydration guidance, and unpinned `npx` in command examples.
 *
 * So the honest reading is that the scanner works and the corpus is clean, and a
 * gate that failed on those six would be permanently red. That is the same
 * disposition as SEM-2's 543 semgrep findings: the remedy is not to stop running
 * the scanner, it is to record each finding with a reason and keep the count
 * visible. `docs/quality/skill-findings-baseline.json` is that record.
 *
 * **The gate blocks on unbaselined findings, not on the aggregate verdict.** A
 * tree of baselined false positives returns `DO_NOT_INSTALL` for ever, so failing
 * on the aggregate would mean red for ever. The aggregate is still printed, so a
 * change in it is visible, and the reason a zero exit next to `DO_NOT_INSTALL` is
 * stated in the output rather than left to be inferred.
 *
 * **Still not in `verify`, and still `pr-reporting`, for two checkable reasons.**
 * CI has no skillspector installed, so a CI run today would record
 * `not_configured` — which is a step that compares against an input nobody
 * produced, the RF-9 shape. And the scan was not complete: `is_complete` was
 * `false` at 97.7%, with three files partially inspected because
 * `static_patterns_tool_misuse` hit its `static_parse_limit`, and that analyzer
 * reported `degraded`. The gate reports both rather than printing a clean summary
 * over them.
 *
 * Graduating is one commit that installs the scanner in the `security` job and
 * moves the tier together. The condition is checkable: a CI run in which this
 * script printed a `risk_assessment` rather than `not_configured`, with
 * `is_complete: true` and no degraded analyzers.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HOST_SCANNERS_ENV,
  HOST_SCANNERS_UNAVAILABLE,
  isHostDegradationOptedIn,
  notConfiguredMessage,
  scanTimeoutMs,
} from './lib/host-scanners.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** The one directory this gate reads. Scoped, so a new tree cannot silently widen it. */
export const SKILL_ROOT = path.join(repoRoot, '.kilo', 'skills');

/** The vendored skills, by name. Each is recorded with a hash in `skills-lock.json`. */
export const VENDORED = Object.freeze([
  'supabase-postgres-best-practices',
  'vercel-composition-patterns',
  'vercel-react-best-practices',
  'web-design-guidelines',
]);

/**
 * Whether `skillspector` can produce a scan on this host.
 *
 * Separated from the spawn so a test can prove the boundary without a Python
 * toolchain installed. Returns a reason rather than a boolean because
 * `notConfiguredMessage` names the reason, and "the scanner is missing" and "the
 * scanner crashed" send a reader to different places.
 *
 * @param {(command: string, args: string[]) => { status: number | null, stderr: string }} probe
 * @returns {{ available: boolean, reason: string }}
 */
export function probeScanner(probe) {
  let result;
  try {
    result = probe('skillspector', ['--version']);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { available: false, reason: `skillspector could not be invoked (${detail})` };
  }
  if (result.status === 0) return { available: true, reason: '' };
  // A non-zero status from `--version` is the ENOENT case on every platform Kilo
  // runs on: the shell resolved no binary. Anything else is a broken install, and
  // the two must not be reported the same way.
  return { available: false, reason: 'skillspector is not installed or not on PATH' };
}

/**
 * Turn a skillspector JSON report into a pass/fail decision.
 *
 * The report's own verdict is used rather than a re-derived risk score: skillspector
 * weights severity, applies an executable multiplier, and maps the total to
 * `SAFE` / `CAUTION` / `DO_NOT_INSTALL`. Recomputing that here would be a second
 * authority for the same judgement, and it would drift the moment NVIDIA changes
 * the weights.
 *
 * A report that parses but carries no verdict is a **failure**, not a pass. The
 * same reasoning as `P-18`: a claim with no content is a claim nobody checked.
 *
 * @param {unknown} report the parsed JSON
 * @returns {{ ok: boolean, reason: string }}
 */
export function verdictFor(report) {
  if (typeof report !== 'object' || report === null) {
    return { ok: false, reason: 'skillspector produced no JSON report' };
  }
  const assessment = /** @type {Record<string, unknown>} */ (report).risk_assessment;
  if (typeof assessment !== 'object' || assessment === null) {
    return { ok: false, reason: 'the report carries no `risk_assessment`' };
  }
  // Narrowed to `object` by the guard above, so the index signature is re-asserted
  // rather than assumed. `unknown` is the honest type for parsed JSON: every field
  // is checked before it is used, which is the point of the function.
  const verdict = /** @type {Record<string, unknown>} */ (assessment);
  const recommendation = verdict.recommendation;
  const score = verdict.score;
  if (typeof recommendation !== 'string') {
    return { ok: false, reason: 'the report carries no `recommendation`' };
  }
  if (recommendation === 'DO_NOT_INSTALL') {
    return { ok: false, reason: `DO_NOT_INSTALL (risk_score ${String(score)})` };
  }
  return { ok: true, reason: `${recommendation} (risk_score ${String(score)})` };
}

/**
 * Separate the findings the baseline accounts for from the ones it does not.
 *
 * **Keyed on `match_fingerprint`, never on `finding_id`.** Two scans of this same
 * tree on the same day produced different `finding_id` values for identical
 * findings — the id is regenerated per run. A baseline keyed on it would fail on
 * every scan and be deleted inside a week, which is worse than having none. The
 * fingerprint is the content address and was byte-identical across both runs.
 *
 * A **stale** entry — one the scanner no longer reports — is a finding rather than
 * a silent cleanup, for the same reason the coverage ratchet fails on a lowered
 * floor: a baseline that quietly shrinks is how a gate starts agreeing with the
 * tree instead of with the code.
 *
 * @param {unknown} report the parsed JSON report
 * @param {Set<string>} known fingerprints recorded in the baseline
 * @returns {{ newFindings: Array<{ id: string, severity: string, location: string, matched: string }>, stale: string[], total: number }}
 */
export function classifyFindings(report, known) {
  const issues =
    typeof report === 'object' &&
    report !== null &&
    Array.isArray(/** @type {Record<string, unknown>} */ (report).issues)
      ? /** @type {Array<Record<string, unknown>>} */ (
          /** @type {Record<string, unknown>} */ (report).issues
        )
      : [];

  const seen = new Set();
  const newFindings = [];
  for (const issue of issues) {
    const fingerprint = typeof issue.match_fingerprint === 'string' ? issue.match_fingerprint : '';
    if (fingerprint !== '') seen.add(fingerprint);
    if (known.has(fingerprint)) continue;
    const location = /** @type {Record<string, unknown>} */ (issue.location ?? {});
    newFindings.push({
      id: String(issue.id ?? '?'),
      severity: String(issue.severity ?? '?'),
      location: `${String(location.file ?? '?')}:${String(location.start_line ?? '?')}`,
      matched: String(issue.finding ?? ''),
    });
  }

  const stale = [...known].filter((fingerprint) => !seen.has(fingerprint));
  return { newFindings, stale, total: issues.length };
}

/**
 * The completeness the scanner itself reported.
 *
 * A scan that did not finish everything is not a clean scan, and the difference
 * between "found nothing" and "found nothing in 97.7% of it" is the whole reason
 * this exists. Reported rather than enforced, because a ceiling small enough to
 * guarantee a failure is the same defect the host-scanners boundary guards
 * against for the other scanners.
 *
 * @param {unknown} report the parsed JSON report
 * @returns {{ complete: boolean, coverage: string, degraded: string[] }}
 */
export function completenessFor(report) {
  const record = /** @type {Record<string, unknown>} */ (
    typeof report === 'object' && report !== null ? report : {}
  );
  const completeness = /** @type {Record<string, unknown>} */ (record.analysis_completeness ?? {});
  const statuses = /** @type {Array<Record<string, unknown>>} */ (
    completeness.analyzer_statuses ?? []
  );
  return {
    complete: completeness.is_complete === true,
    coverage:
      typeof completeness.coverage_percent === 'number'
        ? `${completeness.coverage_percent}% (${String(completeness.scanned_components ?? '?')}/${String(completeness.total_components ?? '?')})`
        : 'unknown',
    degraded: statuses
      .filter((status) => status.status === 'degraded' || status.status === 'failed')
      .map((status) => String(status.analyzer_id ?? '?')),
  };
}

export function main() {
  if (!existsSync(SKILL_ROOT)) {
    // Nothing to scan is not a failure. A repository with no skills has no skill
    // supply chain, and failing here would make the gate's absence mandatory.
    console.log('skill-scan: no .kilo/skills directory — nothing to scan.');
    return 0;
  }

  const status = probeScanner((command, args) => {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: scanTimeoutMs(process.env.AUTOMATE_SCAN_TIMEOUT_MS),
    });
    return { status: result.status, stderr: result.stderr ?? '' };
  });

  if (!status.available) {
    if (isHostDegradationOptedIn(process.env)) {
      console.log(
        notConfiguredMessage([`skills: ${status.reason}`]).replace(
          /^Static analysis:/,
          'Skill scan:',
        ),
      );
      return 0;
    }
    console.error(
      `skill-scan: ${status.reason}. A skill is instructions the agent obeys, and an ` +
        'unrun scan of one is not a pass.\n' +
        `  install:   uv tool install 'skillspector @ git+https://github.com/NVIDIA/skillspector.git'\n` +
        `  or opt in: ${HOST_SCANNERS_ENV}=${HOST_SCANNERS_UNAVAILABLE} (local hosts only; CI must install it)`,
    );
    return 1;
  }

  const result = spawnSync('skillspector', ['scan', SKILL_ROOT, '--no-llm', '--format', 'json'], {
    encoding: 'utf8',
    timeout: scanTimeoutMs(process.env.AUTOMATE_SCAN_TIMEOUT_MS),
  });

  if (result.error) {
    const detail = result.error instanceof Error ? result.error.message : String(result.error);
    console.error(`skill-scan: the scanner failed to run (${detail}).`);
    return 2;
  }

  // A killed scanner is unavailable, never clean. Counting a ten-minute stall as
  // a pass is the exact outcome the host-scanners boundary exists to prevent.
  if (result.signal !== null) {
    const timeout = scanTimeoutMs(process.env.AUTOMATE_SCAN_TIMEOUT_MS);
    console.error(
      `skill-scan: the scanner was killed at the ${Math.round(timeout / 1000)}s ceiling. ` +
        'That is unavailable, not clean — raise AUTOMATE_SCAN_TIMEOUT_MS if the scan is genuinely this slow.',
    );
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    console.error('skill-scan: the scanner exited without a readable JSON report.');
    return 2;
  }

  const known = knownFingerprints();
  const { newFindings, stale, total } = classifyFindings(parsed, known);
  const completeness = completenessFor(parsed);
  const verdict = verdictFor(parsed);

  const lines = [
    `skill-scan: ${total - newFindings.length}/${total} findings baselined, ${newFindings.length} new`,
    `  scanner verdict      ${verdict.reason}  (advisory)`,
    `  findings             ${total} reported, ${total - newFindings.length} baselined, ${newFindings.length} new`,
    `  coverage             ${completeness.coverage}${completeness.complete ? '' : ' — NOT complete'}`,
  ];
  if (completeness.degraded.length > 0) {
    lines.push(`  degraded analyzers   ${completeness.degraded.join(', ')}`);
  }
  lines.push(
    `  provenance           4 authored, ${VENDORED.length} vendored; source + hash in skills-lock.json`,
  );

  if (!verdict.ok && newFindings.length === 0) {
    // The scanner's aggregate verdict is derived from findings, so a tree of
    // baselined false positives keeps returning DO_NOT_INSTALL forever. The gate
    // blocks on *unbaselined findings* rather than on the aggregate, and says so
    // rather than leaving a reader to wonder why `DO_NOT_INSTALL` exited zero.
    lines.push(
      '',
      'The scanner still returns DO_NOT_INSTALL, and this run passes, because every finding behind',
      'that verdict is in the baseline with a stated reason. The per-finding decision is the gate;',
      'the aggregate is reported so a change in it is visible.',
    );
  }

  if (newFindings.length > 0) {
    lines.push(
      '',
      'NEW findings — not in the baseline. Read each before deciding it is a false positive:',
    );
    for (const finding of newFindings) {
      lines.push(
        `  [${finding.severity}] ${finding.id}  ${finding.location}  "${finding.matched}"`,
      );
    }
    lines.push(
      '',
      'To baseline one, add its `match_fingerprint` and a reason to docs/quality/skill-findings-baseline.json.',
    );
  }
  if (stale.length > 0) {
    lines.push(
      '',
      `STALE baseline entries — the scanner no longer reports ${stale.length} of them.`,
      'Remove them, or the gate is holding a record the tree has outgrown.',
    );
  }

  // A stale entry fails alongside a new one. Both mean the baseline and the tree
  // disagree, and a baseline that drifts is how this becomes a gate nobody reads.
  if (newFindings.length > 0 || stale.length > 0) {
    console.error(lines.join('\n'));
    return 1;
  }

  console.log(lines.join('\n'));
  return 0;
}

/**
 * The baseline fingerprints.
 *
 * An absent or unreadable baseline yields an empty set, which makes every finding
 * new. That is the fail-closed direction and is deliberate: a gate whose
 * suppression list went missing should report six findings, not zero.
 *
 * @returns {Set<string>}
 */
export function knownFingerprints() {
  const baselinePath = path.join(repoRoot, 'docs', 'quality', 'skill-findings-baseline.json');
  if (!existsSync(baselinePath)) return new Set();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    return new Set();
  }
  const record = /** @type {Record<string, unknown>} */ (
    typeof parsed === 'object' && parsed !== null ? parsed : {}
  );
  const findings = Array.isArray(record.findings)
    ? /** @type {Array<Record<string, unknown>>} */ (record.findings)
    : [];
  return new Set(
    findings
      .map((finding) => finding.matchFingerprint)
      .filter((fingerprint) => typeof fingerprint === 'string'),
  );
}

/**
 * Only exit when executed directly. `scripts/lib/skill-scan.test.mjs` imports
 * `probeScanner` and `verdictFor` from here, and an unconditional
 * `process.exit(main())` would end the test runner the moment the module loads —
 * a green test file that asserted nothing, which is the failure this repository
 * has already had to fix twice.
 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
