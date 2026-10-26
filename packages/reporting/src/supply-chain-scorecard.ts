import type { Scorecard } from '@automate/shared-contracts';
import {
  absent,
  assemble,
  measuredMetric,
  plural,
  round1,
  windowOf,
  type MetricShape,
  type Reading,
} from './scorecard-kit.js';

/**
 * The supply-chain scorecard: what this repository ships, and whether anyone can show it.
 *
 * Five readings, each from evidence the upload door already stores:
 *
 * - **SLSA build level** — the level the latest verified provenance supports, 0–3.
 * - **Licence violations** — open findings of the licence policy. No policy is no judge,
 *   so the reading is `not_configured`, never a clean zero.
 * - **Fixable critical vulnerabilities** — the same condition as the grade's hard gate; one
 *   fails the card.
 * - **Open vulnerable components** — every open vulnerability finding.
 * - **SBOM age** — days since the newest inventory arrived on the branch.
 *
 * VEX coverage — the share of vulnerability findings a VEX statement decided — is shown and
 * not scored: a statement is a claim about exploitability, and a card that rewarded more
 * claims would reward writing them.
 *
 * The score is the **weakest** scored reading (a chain is as strong as its weakest link, and
 * a supply chain is one), and `cappedBy` names it. Pure: the clock is the injected `now`.
 */

export interface SupplyChainScorecardInput {
  /** The level the latest provenance supports, 0–3; `null` when none was uploaded. */
  slsaLevel: number | null;
  /** Open licence findings; `null` when no licence policy judges the inventory. */
  licences: { open: number; denied: number } | null;
  /** Open vulnerability findings; `null` when no SBOM or dependency scanner has reported. */
  vulnerabilities: { open: number; fixableCritical: number } | null;
  /** VEX documents stored, and vulnerability findings — and of those, VEX-decided ones. */
  vex: { documents: number; vulnerabilities: number; decided: number };
  /** When the newest SBOM on the branch arrived; `null` when none has. */
  sbomAt: Date | null;
}

export interface SupplyChainScorecardPolicy {
  /** Older than this is stale. Default 30 days. */
  maxSbomAgeDays?: number;
  /** A provenance level below this fails the card. Unset: the level is shown, never failed. */
  minSlsaLevel?: number;
}

export const DEFAULT_MAX_SBOM_AGE_DAYS = 30;
const DAY_MS = 86_400_000;

const SLSA: MetricShape = {
  key: 'slsa-level',
  label: 'SLSA build level',
  unit: 'score',
  direction: 'higher-better',
  target: 3,
};

function slsaReading(level: number | null, minimum: number | undefined): Reading {
  const shape = { ...SLSA, target: minimum ?? SLSA.target };
  if (level === null || !Number.isFinite(level)) {
    return absent(shape, 'not_configured', 'No build provenance was uploaded.');
  }
  const value = Math.min(3, Math.max(0, Math.round(level)));
  const below = minimum !== undefined && value < minimum;
  return {
    metric: measuredMetric(shape, {
      value,
      status: below || value === 0 ? 'bad' : value === 1 ? 'warn' : 'good',
      summary: `The latest provenance supports SLSA build level ${String(value)} of 3.`,
    }),
    points: (value / 3) * 100,
    reason: below
      ? `Provenance supports SLSA build level ${String(value)}; the policy requires ${String(minimum)}.`
      : null,
  };
}

function licenceReading(licences: SupplyChainScorecardInput['licences']): Reading {
  const shape: MetricShape = {
    key: 'licence-violations',
    label: 'Licence violations',
    unit: 'count',
    direction: 'lower-better',
    target: 0,
  };
  if (licences === null) {
    return absent(shape, 'not_configured', 'No licence policy judges the inventory.');
  }
  const open = Math.max(0, licences.open);
  const denied = Math.max(0, licences.denied);
  return {
    metric: measuredMetric(shape, {
      value: open,
      status: denied > 0 ? 'bad' : open > 0 ? 'warn' : 'good',
      summary:
        open === 0
          ? 'Every component is under a licence the policy allows.'
          : `${plural(open, 'component breaks', 'components break')} the licence policy, ${String(denied)} under a denied licence.`,
    }),
    points: Math.max(0, 100 - 20 * open),
    reason:
      denied > 0
        ? `${plural(denied, 'component ships', 'components ship')} under a denied licence.`
        : null,
  };
}

function criticalReading(vulnerabilities: SupplyChainScorecardInput['vulnerabilities']): Reading {
  const shape: MetricShape = {
    key: 'fixable-critical',
    label: 'Fixable critical vulnerabilities',
    unit: 'count',
    direction: 'lower-better',
    target: 0,
  };
  if (vulnerabilities === null) {
    return absent(shape, 'not_configured', 'No SBOM or dependency scanner reported.');
  }
  const count = Math.max(0, vulnerabilities.fixableCritical);
  return {
    metric: measuredMetric(shape, {
      value: count,
      status: count === 0 ? 'good' : 'bad',
      summary:
        count === 0
          ? 'No critical vulnerability with a fix available is open.'
          : `${plural(count, 'critical vulnerability has', 'critical vulnerabilities have')} a fix available and ${count === 1 ? 'is' : 'are'} open.`,
    }),
    points: count === 0 ? 100 : 0,
    reason:
      count === 0
        ? null
        : `${plural(count, 'critical vulnerability', 'critical vulnerabilities')} with a fix available ${count === 1 ? 'is' : 'are'} open.`,
  };
}

function vulnerableReading(vulnerabilities: SupplyChainScorecardInput['vulnerabilities']): Reading {
  const shape: MetricShape = {
    key: 'open-vulnerabilities',
    label: 'Open vulnerable components',
    unit: 'count',
    direction: 'lower-better',
    target: 0,
  };
  if (vulnerabilities === null) {
    return absent(shape, 'not_configured', 'No SBOM or dependency scanner reported.');
  }
  const open = Math.max(0, vulnerabilities.open);
  return {
    metric: measuredMetric(shape, {
      value: open,
      status: open === 0 ? 'good' : open <= 10 ? 'warn' : 'bad',
      summary: `${plural(open, 'vulnerability finding is', 'vulnerability findings are')} open.`,
    }),
    points: Math.max(0, 100 - 5 * open),
    reason: null,
  };
}

function vexReading(vex: SupplyChainScorecardInput['vex']): Reading {
  const shape: MetricShape = {
    key: 'vex-coverage',
    label: 'Vulnerabilities decided by VEX',
    unit: 'ratio',
    direction: 'higher-better',
    target: null,
  };
  if (vex.documents <= 0) {
    return absent(shape, 'not_configured', 'No VEX document was uploaded.');
  }
  if (vex.vulnerabilities <= 0) {
    return absent(shape, 'insufficient', 'No vulnerability finding to decide.', 0);
  }
  const decided = Math.min(vex.vulnerabilities, Math.max(0, vex.decided));
  const value = decided / vex.vulnerabilities;
  return {
    metric: measuredMetric(shape, {
      value,
      status: value >= 0.8 ? 'good' : value >= 0.3 ? 'warn' : 'bad',
      summary: `${String(decided)} of ${plural(vex.vulnerabilities, 'vulnerability finding', 'vulnerability findings')} carry a VEX statement.`,
      sampleSize: vex.vulnerabilities,
    }),
    points: null,
    reason: null,
  };
}

function sbomReading(sbomAt: Date | null, now: Date, maxAge: number): Reading {
  const shape: MetricShape = {
    key: 'sbom-age',
    label: 'SBOM age',
    unit: 'days',
    direction: 'lower-better',
    target: maxAge,
  };
  if (sbomAt === null) {
    return absent(shape, 'not_configured', 'No SBOM was uploaded for this branch.');
  }
  const days = round1(Math.max(0, now.getTime() - sbomAt.getTime()) / DAY_MS);
  const fresh = days <= maxAge;
  const stale = days > 2 * maxAge;
  return {
    metric: measuredMetric(shape, {
      value: days,
      status: fresh ? 'good' : stale ? 'bad' : 'warn',
      summary: `The newest SBOM arrived ${String(days)} days ago; older than ${String(maxAge)} is stale.`,
    }),
    points: fresh ? 100 : stale ? 0 : 50,
    reason: null,
  };
}

/** The supply-chain scorecard. Inputs a contract would refuse are clamped, never thrown. */
export function supplyChainScorecard(
  input: SupplyChainScorecardInput,
  options: { now: Date; windowDays: number; policy?: SupplyChainScorecardPolicy },
): Scorecard {
  const policy = options.policy ?? {};
  const maxAge =
    policy.maxSbomAgeDays !== undefined && policy.maxSbomAgeDays > 0
      ? policy.maxSbomAgeDays
      : DEFAULT_MAX_SBOM_AGE_DAYS;
  const readings = [
    slsaReading(input.slsaLevel, policy.minSlsaLevel),
    licenceReading(input.licences),
    criticalReading(input.vulnerabilities),
    vulnerableReading(input.vulnerabilities),
    vexReading(input.vex),
    sbomReading(input.sbomAt, options.now, maxAge),
  ];
  return assemble(readings, {
    id: 'supply-chain',
    title: 'Supply chain',
    dimension: 'supply-chain',
    evaluatedAt: options.now.toISOString(),
    windowDays: windowOf(options.windowDays),
  });
}
