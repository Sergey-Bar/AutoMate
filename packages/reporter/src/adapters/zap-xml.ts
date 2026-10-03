import type { CanonicalRunResult } from '@automate/shared-contracts';
import { canonicalRunResult, type CanonicalAttemptInput } from '../canonical-run-result.js';
import type { ProducerAdapter, ProducerContext } from '../adapter.js';
import { canonicalTestStatusFrom, type CanonicalStatus } from '../producer-status.js';

/**
 * OWASP ZAP XML — a dynamic security scan, ingested as a **run result**.
 *
 * ## An alert is a finding, not a test — and the risk code decides
 *
 * ZAP has no suite and no pass/fail. It has *alerts*, each carrying a `riskcode`
 * and an occurrence `count`. Mapping them onto the canonical vocabulary is a
 * judgement, so the judgement is written down and asserted rather than implied:
 *
 *  - `riskcode 0` (Informational) → `skipped`. Not a finding; ZAP reports these
 *    for every response header worth naming, and failing a run on them would make
 *    the security row permanently red and therefore permanently ignored.
 *  - `riskcode 1..3` (Low, Medium, High) → `failed`. Anything actionable fails the
 *    scan. "Low" is where the actionable ones start.
 *  - **an unrecognised risk code → `unknown`.** Not `0`. Reading an unknown
 *    severity as Informational reports "nothing found" for something the scanner
 *    found and this build cannot read — which is the exact failure mode a
 *    security row must never have.
 *
 * ## A clean scan passes
 *
 * A report with no alerts is `passed`, not `unknown`. An operator who ran a scan
 * and got nothing has evidence; reporting that as unobserved would make every
 * clean scan indistinguishable from a broken pipeline.
 */

export const ZAP_XML_ADAPTER_VERSION = '1';

/**
 * ZAP's risk codes, through the producer status table.
 *
 * Routed through `canonicalTestStatusFrom` rather than a second literal table, so
 * the vocabulary is the one `producer-status.ts` owns and a risk code added
 * without a row there is a compile-time concern rather than a silent default.
 */
export const ZAP_RISK_BY_CODE: Readonly<Record<number, CanonicalStatus>> = {
  0: canonicalTestStatusFrom('zap', 'informational'),
  1: canonicalTestStatusFrom('zap', 'low'),
  2: canonicalTestStatusFrom('zap', 'medium'),
  3: canonicalTestStatusFrom('zap', 'high'),
};

/** One `<alertitem>` as ZAP writes it. */
interface ZapAlert {
  pluginId: string;
  alert: string;
  riskcode: string;
  count: string;
  desc: string;
  solution: string;
  riskdesc: string;
  cweid: string;
  host: string;
}

const ALERT_ITEM = /<alertitem>([\s\S]*?)<\/alertitem>/giu;

/**
 * Reads the alert items out of the report.
 *
 * A small reader rather than an XML library: ZAP's report is a fixed, shallow
 * document with one repeating element, and adding a parser dependency for it would
 * be a dependency for twenty lines. The tag names are read exactly and the values
 * are XML-entity decoded, so a title containing `&amp;` does not come out mangled.
 */
function readAlerts(document: string): ZapAlert[] {
  const alerts: ZapAlert[] = [];
  for (const match of document.matchAll(ALERT_ITEM)) {
    const body = match[1];
    if (body === undefined) continue;
    const host = /<site\b[^>]*\bhost="([^"]*)"/iu.exec(hostOf(document, body));
    alerts.push({
      pluginId: tag(body, 'pluginid'),
      alert: decode(tag(body, 'alert')),
      riskcode: tag(body, 'riskcode'),
      count: tag(body, 'count'),
      desc: decode(tag(body, 'desc')),
      solution: decode(tag(body, 'solution')),
      riskdesc: decode(tag(body, 'riskdesc')),
      cweid: tag(body, 'cweid'),
      host: host?.[1] ?? '',
    });
  }
  return alerts;
}

/**
 * The `<site host=…>` enclosing an alert.
 *
 * Deliberately approximate — it searches forward from the alert for the enclosing
 * site's host. A full XML parse would be correct here and is not worth a
 * dependency; the field is attribution, not a verdict, and an absent host is
 * rendered as an absent host rather than guessed.
 */
function hostOf(document: string, from: string): string {
  const before = document.slice(Math.max(0, document.length - from.length - 4000));
  const sites = [...before.matchAll(/<site\b[^>]*\bhost="([^"]*)"[^>]*>/giu)];
  return sites[sites.length - 1]?.[0] ?? '';
}

function tag(body: string, name: string): string {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'iu').exec(body);
  return (match?.[1] ?? '').trim();
}

/** The five entities ZAP emits, and nothing else. */
function decode(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** `3` → `failed`, `0` → `skipped`, `7` → `unknown`. Never a default of `passed`. */
function statusForRisk(riskcode: string): CanonicalStatus {
  const code = Number(riskcode);
  return ZAP_RISK_BY_CODE[code] ?? 'unknown';
}

export function parseZapReport(input: Uint8Array, context: ProducerContext): CanonicalRunResult {
  const document = new TextDecoder().decode(input);
  if (!/OWASPZAPReport/iu.test(document)) {
    throw new Error('document is not a ZAP report');
  }
  if (!/<alerts\b/iu.test(document)) {
    throw new Error('ZAP report declares no alerts element, so it is not a scan result');
  }
  const alerts = readAlerts(document);

  // A scan that ran and found nothing is a pass. An empty attempt list would reach
  // `runStatusFrom([])`, which returns `skipped` — a decision somebody made,
  // which is not what happened.
  if (alerts.length === 0) {
    return canonicalRunResult(
      {
        outcomes: ['passed'],
        attempts: [
          {
            index: 1,
            testId: 'zap.scan',
            specPath: 'zap/scan',
            title: 'ZAP scan completed and raised no alerts',
            status: 'passed',
            rawStatus: '0',
            startedAt: context.startedAt,
            flakiness: 'unknown',
          },
        ],
        producer: 'zap',
        verifier: 'packages/reporter zap-xml',
        provenance: { alerts: 0 },
      },
      context,
    );
  }

  const attempts: CanonicalAttemptInput[] = alerts.map((alert, position) => {
    const status = statusForRisk(alert.riskcode);
    const occurrences = Number(alert.count);
    const count = Number.isFinite(occurrences) ? occurrences : 1;
    const title = `${alert.alert}${count > 1 ? ` (${count} occurrences)` : ''}`;
    return {
      index: 1,
      testId: `zap.${alert.pluginId || position}`,
      specPath: `zap/${alert.host || 'unknown-host'}/${alert.pluginId || position}`,
      title,
      status,
      rawStatus: alert.riskcode,
      startedAt: context.startedAt,
      flakiness: 'unknown',
      ...(status === 'failed'
        ? {
            error: {
              message: `${title}\n${alert.riskdesc || 'Risk ' + alert.riskcode}\n${alert.solution}`,
            },
          }
        : {}),
    };
  });

  return canonicalRunResult(
    {
      outcomes: attempts.map((attempt) => attempt.status),
      attempts,
      producer: 'zap',
      verifier: 'packages/reporter zap-xml',
      // Every alert, verbatim. The score reads the *count* of what a scanner
      // found, and a verdict without the findings behind it cannot be re-derived.
      provenance: {
        alerts: alerts.length,
        findings: alerts.map((alert) => ({
          pluginId: alert.pluginId,
          alert: alert.alert,
          riskcode: alert.riskcode,
          count: alert.count,
          cweid: alert.cweid,
          host: alert.host,
        })),
      },
    },
    context,
  );
}

export const ZAP_XML_ADAPTER: ProducerAdapter = {
  mediaType: 'application/xml',
  parse: (input, context) => parseZapReport(input, context),
};
