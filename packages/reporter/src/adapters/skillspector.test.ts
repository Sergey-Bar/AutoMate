import { createHash } from 'node:crypto';
import { CanonicalFindingSchema } from '@automate/shared-contracts';
import { describe, expect, it } from 'vitest';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES, MAX_SARIF_RESULTS } from './sarif.js';
import { parseSkillSpector, SKILLSPECTOR_ADAPTER_VERSION } from './skillspector.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

/**
 * Shaped like the skillspector 2.12.0 `--format json` report this repository recorded on
 * 2026-10-02 (docs/quality/skill-findings-baseline.json, read by scripts/skill-scan.mjs):
 * `risk_assessment`, `issues[]` with `id`, `severity`, `finding`, `match_fingerprint` and
 * `location.{file,start_line}`, and `analysis_completeness`.
 */
const REPORT = {
  risk_assessment: { recommendation: 'DO_NOT_INSTALL', score: 56 },
  issues: [
    {
      id: 'MP3',
      finding_id: 'f-2c1d',
      severity: 'HIGH',
      title: 'Memory poisoning',
      description: 'Instruction manipulates stored agent context.',
      finding: 'clear context',
      match_fingerprint: 'a2bfb0d7cc6cfe091106d72bc83701d46f04fadd9e90ccddd446da3e6aceb44e',
      location: { file: 'vercel-composition-patterns/README.md', start_line: 28 },
    },
    {
      id: 'OH1',
      finding_id: 'f-9e0a',
      severity: 'HIGH',
      finding: 'dangerouslySetInnerHTML={',
      match_fingerprint: '152a270c69e5f498026be5430f75d09c53e612d4c86635345fe7e35d93b38ee0',
      location: { file: 'vercel-react-best-practices\\AGENTS.md', start_line: 2537 },
    },
    {
      id: 'OH1',
      finding_id: 'f-11aa',
      severity: 'HIGH',
      finding: 'dangerouslySetInnerHTML={',
      match_fingerprint: '152a270c69e5f498026be5430f75d09c53e612d4c86635345fe7e35d93b38ee0',
      location: {
        file: 'vercel-react-best-practices/rules/rendering-hydration-no-flicker.md',
        start_line: 63,
      },
    },
    {
      id: 'RP1',
      finding_id: 'f-77b2',
      severity: 'MEDIUM',
      message: 'Unpinned package runner',
      finding: 'npx playwright',
      match_fingerprint: '5d1e71786bcce07e288b1b7488d594b4d051d0f6efefb2c50641987706a012da',
      location: { file: 'evidence-test/SKILL.md', start_line: 78 },
    },
  ],
  analysis_completeness: { is_complete: false, coverage_percent: 95.8 },
};

describe('parseSkillSpector', () => {
  it('reads the real report shape into canonical ai-governance findings', () => {
    const findings = parseSkillSpector(bytes(REPORT));
    expect(findings).toHaveLength(4);
    for (const finding of findings)
      expect(() => CanonicalFindingSchema.parse(finding)).not.toThrow();
    expect(findings[0]).toEqual({
      fingerprint: createHash('sha256')
        .update(
          'skillspector\u0000a2bfb0d7cc6cfe091106d72bc83701d46f04fadd9e90ccddd446da3e6aceb44e\u0000vercel-composition-patterns/README.md',
        )
        .digest('hex'),
      tool: 'skillspector',
      ruleId: 'MP3',
      kind: 'issue',
      severity: 'high',
      dimension: 'ai-governance',
      path: 'vercel-composition-patterns/README.md',
      line: 28,
      message: 'MP3: Instruction manipulates stored agent context. Matched "clear context".',
      helpUri: null,
      fixAvailable: null,
    });
    expect(findings[1]).toMatchObject({
      path: 'vercel-react-best-practices/AGENTS.md',
      line: 2537,
    });
    expect(findings[1]?.message).toBe('OH1: matched "dangerouslySetInnerHTML={".');
    expect(findings[3]).toMatchObject({ ruleId: 'RP1', severity: 'medium' });
    expect(findings[3]?.message).toBe('RP1: Unpinned package runner. Matched "npx playwright".');
  });

  it('keys identity on match_fingerprint and path — never finding_id, which changes every run', () => {
    const rerun = {
      ...REPORT,
      issues: REPORT.issues.map((issue, index) => ({
        ...issue,
        finding_id: `regenerated-${index}`,
      })),
    };
    const first = parseSkillSpector(bytes(REPORT)).map((finding) => finding.fingerprint);
    const second = parseSkillSpector(bytes(rerun)).map((finding) => finding.fingerprint);
    expect(second).toEqual(first);
    // One pattern matched in two files is two findings, each with its own location.
    expect(new Set(first).size).toBe(4);
  });

  it('collapses an exact duplicate (same fingerprint and file)', () => {
    const issue = REPORT.issues[0];
    expect(
      parseSkillSpector(bytes({ issues: [issue, { ...issue, finding_id: 'x' }] })),
    ).toHaveLength(1);
  });

  it('falls back to rule, path and the normalised match when match_fingerprint is missing', () => {
    const issue = {
      id: 'EA2',
      severity: 'LOW',
      finding: '  Without   Asking ',
      location: { file: 'a/SKILL.md', start_line: 3 },
    };
    const [finding] = parseSkillSpector(
      bytes({ issues: [issue, { ...issue, finding_id: 'other' }] }),
    );
    expect(finding?.fingerprint).toBe(
      createHash('sha256')
        .update('skillspector\u0000EA2\u0000a/SKILL.md\u0000without asking')
        .digest('hex'),
    );
    expect(finding?.severity).toBe('low');
    expect(
      parseSkillSpector(bytes({ issues: [issue, { ...issue, finding: 'another' }] })),
    ).toHaveLength(2);
  });

  it.each([
    ['CRITICAL', 'critical'],
    ['high', 'high'],
    ['Medium', 'medium'],
    ['LOW', 'low'],
    ['INFO', 'info'],
    ['WEIRD', 'medium'],
    [7, 'medium'],
  ])('maps severity %s to %s', (severity, expected) => {
    const [finding] = parseSkillSpector(
      bytes({ issues: [{ id: 'X1', severity, match_fingerprint: 'f' }] }),
    );
    expect(finding?.severity).toBe(expected);
  });

  it('describes from title when there is no description, and states a match-less issue plainly', () => {
    const [titled, bare] = parseSkillSpector(
      bytes({
        issues: [
          { id: 'T1', title: 'Tool misuse!', match_fingerprint: 't1' },
          { id: 'T2', finding: '' },
        ],
      }),
    );
    expect(titled?.message).toBe('T1: Tool misuse!');
    expect(bare?.message).toBe('T2: reported by skillspector.');
    expect(bare?.fingerprint).toBe(
      createHash('sha256').update('skillspector\u0000T2\u0000\u0000').digest('hex'),
    );
  });

  it('tolerates missing location, line, id and text, and skips non-object issues', () => {
    const findings = parseSkillSpector(
      bytes({
        issues: [
          null,
          'nope',
          { match_fingerprint: 'm1' },
          { id: 'A', match_fingerprint: 'm2', location: { file: '', start_line: 0 } },
          { id: 'B', match_fingerprint: 'm3', location: { file: 'x.md', start_line: 2.5 } },
          { id: 'C', match_fingerprint: 'm4', location: 'x.md' },
        ],
      }),
    );
    expect(
      findings.map((finding) => [finding.ruleId, finding.path, finding.line, finding.message]),
    ).toEqual([
      ['unknown', null, null, 'unknown: reported by skillspector.'],
      ['A', null, null, 'A: reported by skillspector.'],
      ['B', 'x.md', null, 'B: reported by skillspector.'],
      ['C', null, null, 'C: reported by skillspector.'],
    ]);
    for (const finding of findings)
      expect(() => CanonicalFindingSchema.parse(finding)).not.toThrow();
  });

  it('bounds long fields to the contract', () => {
    const [finding] = parseSkillSpector(
      bytes({
        issues: [
          {
            id: 'R'.repeat(400),
            match_fingerprint: 'f',
            finding: 'z'.repeat(5000),
            location: { file: 'p'.repeat(1200), start_line: 1 },
          },
        ],
      }),
    );
    expect(() => CanonicalFindingSchema.parse(finding)).not.toThrow();
    expect(finding?.ruleId).toHaveLength(300);
    expect(finding?.path).toHaveLength(1000);
    expect(finding?.message).toHaveLength(4000);
  });

  it('accepts a clean report with no issues', () => {
    expect(
      parseSkillSpector(
        bytes({ risk_assessment: { recommendation: 'SAFE', score: 0 }, issues: [] }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['not JSON', new TextEncoder().encode('{ nope'), 'malformed'],
    ['an array', bytes([]), 'malformed'],
    ['no issues array', bytes({ risk_assessment: {} }), 'malformed'],
    ['issues not an array', bytes({ issues: {} }), 'malformed'],
    ['too large', new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1), 'too_large'],
    [
      'too many issues',
      bytes({ issues: Array.from({ length: MAX_SARIF_RESULTS + 1 }, () => ({})) }),
      'too_large',
    ],
  ])('refuses %s', (_label, input, code) => {
    expect(errorCode(() => parseSkillSpector(input))).toBe(code);
  });

  it('has an adapter version', () => {
    expect(SKILLSPECTOR_ADAPTER_VERSION).toBe('1');
  });
});
