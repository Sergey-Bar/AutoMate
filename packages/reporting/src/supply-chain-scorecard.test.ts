import { describe, expect, it } from 'vitest';
import { ScorecardSchema } from '@automate/shared-contracts';
import { supplyChainScorecard, type SupplyChainScorecardInput } from './supply-chain-scorecard.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;
const parsed = (card: unknown) => ScorecardSchema.parse(card);
const byKey = (card: ReturnType<typeof parsed>) =>
  Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));

const NOTHING: SupplyChainScorecardInput = {
  slsaLevel: null,
  licences: null,
  vulnerabilities: null,
  vex: { documents: 0, vulnerabilities: 0, decided: 0 },
  sbomAt: null,
};

const HEALTHY: SupplyChainScorecardInput = {
  slsaLevel: 3,
  licences: { open: 0, denied: 0 },
  vulnerabilities: { open: 0, fixableCritical: 0 },
  vex: { documents: 1, vulnerabilities: 4, decided: 4 },
  sbomAt: new Date(NOW.getTime() - 2 * DAY),
};

describe('supplyChainScorecard', () => {
  it('is not configured when nothing was ever uploaded, and has no score', () => {
    const card = parsed(supplyChainScorecard(NOTHING, { now: NOW, windowDays: 30 }));
    expect(card).toMatchObject({
      id: 'supply-chain',
      dimension: 'supply-chain',
      status: 'not_configured',
      score: null,
      cappedBy: null,
      reasons: [],
      evaluatedAt: NOW.toISOString(),
      windowDays: 30,
    });
    expect(card.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(byKey(card)['licence-violations']?.summary).toMatch(/No licence policy/u);
  });

  it('passes a clean, fresh, attested inventory at 100', () => {
    const card = parsed(supplyChainScorecard(HEALTHY, { now: NOW, windowDays: 30 }));
    expect(card).toMatchObject({ status: 'pass', score: 100, reasons: [] });
    const metrics = byKey(card);
    expect(metrics['slsa-level']).toMatchObject({ value: 3, status: 'good' });
    expect(metrics['vex-coverage']).toMatchObject({ value: 1, status: 'good', sampleSize: 4 });
    expect(metrics['sbom-age']).toMatchObject({ value: 2, status: 'good', target: 30 });
  });

  it('fails on a fixable critical, scores the weakest link, and says why', () => {
    const card = parsed(
      supplyChainScorecard(
        { ...HEALTHY, vulnerabilities: { open: 3, fixableCritical: 1 } },
        { now: NOW, windowDays: 30 },
      ),
    );
    expect(card.status).toBe('fail');
    // The critical reading is 0 points, the weakest of the scored readings.
    expect(card).toMatchObject({ score: 0, cappedBy: 'fixable-critical' });
    expect(card.reasons).toEqual(['1 critical vulnerability with a fix available is open.']);
    expect(byKey(card)['open-vulnerabilities']).toMatchObject({ value: 3, status: 'warn' });
  });

  it('fails a denied licence, warns an unlisted one, and grades SLSA against the policy', () => {
    const unlisted = parsed(
      supplyChainScorecard(
        { ...HEALTHY, licences: { open: 2, denied: 0 }, slsaLevel: 1 },
        { now: NOW, windowDays: 30 },
      ),
    );
    // SLSA 1 of 3 is 33.3 points, below the 60 two open licence findings cost.
    expect(unlisted).toMatchObject({ status: 'pass', score: 33.3, cappedBy: 'slsa-level' });
    expect(byKey(unlisted)['licence-violations']).toMatchObject({ value: 2, status: 'warn' });
    const denied = parsed(
      supplyChainScorecard(
        { ...HEALTHY, licences: { open: 1, denied: 1 }, slsaLevel: 1 },
        { now: NOW, windowDays: 30, policy: { minSlsaLevel: 2 } },
      ),
    );
    expect(denied.status).toBe('fail');
    expect(denied.reasons).toEqual([
      'Provenance supports SLSA build level 1; the policy requires 2.',
      '1 component ships under a denied licence.',
    ]);
    expect(byKey(denied)['slsa-level']).toMatchObject({ status: 'bad', target: 2 });
  });

  it('marks an SBOM stale past the policy age, and bad past twice it', () => {
    const at = (days: number) => new Date(NOW.getTime() - days * DAY);
    const stale = parsed(
      supplyChainScorecard(
        { ...HEALTHY, sbomAt: at(10) },
        { now: NOW, windowDays: 30, policy: { maxSbomAgeDays: 7 } },
      ),
    );
    expect(byKey(stale)['sbom-age']).toMatchObject({ value: 10, status: 'warn', target: 7 });
    expect(stale).toMatchObject({ score: 50, cappedBy: 'sbom-age', status: 'pass' });
    const old = parsed(
      supplyChainScorecard({ ...HEALTHY, sbomAt: at(90) }, { now: NOW, windowDays: 30 }),
    );
    expect(byKey(old)['sbom-age']).toMatchObject({ status: 'bad' });
    expect(old.score).toBe(0);
  });

  it('withholds VEX coverage with nothing to decide, and never scores it', () => {
    const card = parsed(
      supplyChainScorecard(
        { ...NOTHING, vex: { documents: 2, vulnerabilities: 0, decided: 0 } },
        { now: NOW, windowDays: 30 },
      ),
    );
    expect(byKey(card)['vex-coverage']).toMatchObject({ status: 'insufficient', value: null });
    // Something was measured, nothing was scored: insufficient, not a pass.
    expect(card).toMatchObject({ status: 'insufficient', score: null, cappedBy: null });
    const partial = parsed(
      supplyChainScorecard(
        { ...NOTHING, vex: { documents: 1, vulnerabilities: 10, decided: 4 } },
        { now: NOW, windowDays: 30 },
      ),
    );
    expect(byKey(partial)['vex-coverage']).toMatchObject({ value: 0.4, status: 'warn' });
    const thin = parsed(
      supplyChainScorecard(
        { ...NOTHING, vex: { documents: 1, vulnerabilities: 10, decided: 99 } },
        { now: NOW, windowDays: 0 },
      ),
    );
    expect(byKey(thin)['vex-coverage']?.value).toBe(1);
    expect(thin.windowDays).toBe(1);
  });

  it('clamps inputs a contract would refuse rather than throwing', () => {
    const card = parsed(
      supplyChainScorecard(
        {
          slsaLevel: 9,
          licences: { open: -1, denied: -1 },
          vulnerabilities: { open: 40, fixableCritical: -2 },
          vex: { documents: 1, vulnerabilities: 3, decided: 0 },
          sbomAt: new Date(NOW.getTime() + DAY),
        },
        { now: NOW, windowDays: Number.NaN, policy: { maxSbomAgeDays: -3 } },
      ),
    );
    const metrics = byKey(card);
    expect(metrics['slsa-level']?.value).toBe(3);
    expect(metrics['open-vulnerabilities']).toMatchObject({ value: 40, status: 'bad' });
    expect(metrics['vex-coverage']).toMatchObject({ value: 0, status: 'bad' });
    expect(metrics['sbom-age']).toMatchObject({ value: 0, target: 30 });
    expect(card).toMatchObject({ score: 0, cappedBy: 'open-vulnerabilities', windowDays: 1 });
    expect(
      parsed(supplyChainScorecard({ ...NOTHING, slsaLevel: 0 }, { now: NOW, windowDays: 7 })),
    ).toMatchObject({ score: 0, status: 'pass', cappedBy: 'slsa-level' });
  });
});
