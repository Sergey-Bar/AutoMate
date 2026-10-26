import type { FindingSeverity } from '@automate/shared-contracts';

/**
 * A CVSS base score as a finding severity, on the CVSS v3 qualitative bands
 * (9.0 critical, 7.0 high, 4.0 medium, above 0 low, 0 none → info).
 *
 * SARIF's `security-severity` and a CycloneDX rating that carries only a score
 * are banded here, so the two adapters cannot disagree about what a 7.0 is.
 */
export function severityFromCvss(score: number): FindingSeverity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}
