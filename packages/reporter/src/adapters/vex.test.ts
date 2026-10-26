import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { applyVex, parseVex, type VexDocument, type VexFinding } from './vex.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

const OPENVEX = {
  '@context': 'https://openvex.dev/ns/v0.2.0',
  '@id': 'https://openvex.dev/docs/public/vex-2e67563e',
  author: 'Security Team <security@example.com>',
  timestamp: '2024-01-08T18:02:03Z',
  version: 1,
  statements: [
    {
      vulnerability: { name: 'CVE-2021-23337', aliases: ['GHSA-35jh-r3h4-6jhm', 7] },
      products: [
        { '@id': 'pkg:npm/app@1.0.0', subcomponents: [{ '@id': 'pkg:npm/lodash' }, 5] },
        { identifiers: { purl: 'pkg:npm/other@2?arch=x86' } },
        'pkg:npm/legacy-string@1',
      ],
      status: 'not_affected',
      justification: 'vulnerable_code_not_in_execute_path',
    },
    {
      vulnerability: 'CVE-2022-0001',
      products: [{ '@id': 'pkg:npm/b@1' }],
      status: 'affected',
      impact_statement: 'Reachable from the upload handler.',
    },
    { vulnerability: { name: 'CVE-BAD' }, products: [], status: 'maybe' },
    { vulnerability: {}, products: [], status: 'fixed' },
    'not a statement',
  ],
};

const CDX_VEX = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: 'urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79',
  version: 2,
  metadata: { timestamp: '2024-02-01T00:00:00Z', authors: [{ name: 'Product Security' }] },
  components: [
    { 'bom-ref': 'lodash', name: 'lodash', purl: 'pkg:npm/lodash@4.17.21' },
    {
      'bom-ref': 'app',
      name: 'app',
      components: [{ 'bom-ref': 'inner', purl: 'pkg:npm/inner@1' }],
    },
  ],
  vulnerabilities: [
    {
      id: 'CVE-2021-23337',
      references: [{ id: 'GHSA-35jh-r3h4-6jhm' }, {}],
      analysis: { state: 'not_affected', justification: 'code_not_reachable', detail: 'Unused.' },
      affects: [{ ref: 'lodash' }, { ref: 'urn:cdx:other/1#x' }, {}],
    },
    { id: 'CVE-1', analysis: { state: 'false_positive' }, affects: [{ ref: 'inner' }] },
    { id: 'CVE-2', analysis: { state: 'resolved' } },
    { id: 'CVE-3', analysis: { state: 'resolved_with_pedigree' } },
    { id: 'CVE-4', analysis: { state: 'exploitable' } },
    { id: 'CVE-5', analysis: { state: 'in_triage' } },
    { id: 'CVE-6' },
    { id: 'CVE-7', analysis: { state: 'unheard_of' } },
    { analysis: { state: 'resolved' } },
    'not a vulnerability',
  ],
};

describe('parseVex', () => {
  it('reads OpenVEX 0.2.0, products as purls with subcomponents included', () => {
    const parsed = parseVex(bytes(OPENVEX));
    expect(parsed).toEqual({
      id: 'https://openvex.dev/docs/public/vex-2e67563e',
      author: 'Security Team <security@example.com>',
      timestamp: '2024-01-08T18:02:03Z',
      statements: [
        {
          vulnerability: 'CVE-2021-23337',
          aliases: ['GHSA-35jh-r3h4-6jhm'],
          products: [
            'pkg:npm/app@1.0.0',
            'pkg:npm/lodash',
            'pkg:npm/other@2?arch=x86',
            'pkg:npm/legacy-string@1',
          ],
          status: 'not_affected',
          justification: 'vulnerable_code_not_in_execute_path',
          impact: null,
        },
        {
          vulnerability: 'CVE-2022-0001',
          aliases: [],
          products: ['pkg:npm/b@1'],
          status: 'affected',
          justification: null,
          impact: 'Reachable from the upload handler.',
        },
      ],
    });
  });

  it('gives a document without an id a content-derived one, stable across re-reads', () => {
    const document = bytes({ '@context': 'https://openvex.dev/ns', statements: [] });
    const parsed = parseVex(document);
    expect(parsed.id).toBe(`sha256:${createHash('sha256').update(document).digest('hex')}`);
    expect(parseVex(document).id).toBe(parsed.id);
    expect(parsed).toMatchObject({ author: null, timestamp: null, statements: [] });
  });

  it('reads CycloneDX VEX analysis states onto the four VEX statuses', () => {
    const parsed = parseVex(bytes(CDX_VEX));
    expect(parsed.id).toBe('urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79/2');
    expect(parsed.author).toBe('Product Security');
    expect(parsed.timestamp).toBe('2024-02-01T00:00:00Z');
    expect(parsed.statements[0]).toEqual({
      vulnerability: 'CVE-2021-23337',
      aliases: ['GHSA-35jh-r3h4-6jhm'],
      products: ['pkg:npm/lodash@4.17.21', 'urn:cdx:other/1#x'],
      status: 'not_affected',
      justification: 'code_not_reachable',
      impact: 'Unused.',
    });
    expect(
      parsed.statements.map((statement) => [statement.vulnerability, statement.status]),
    ).toEqual([
      ['CVE-2021-23337', 'not_affected'],
      ['CVE-1', 'not_affected'],
      ['CVE-2', 'fixed'],
      ['CVE-3', 'fixed'],
      ['CVE-4', 'affected'],
      ['CVE-5', 'under_investigation'],
    ]);
    expect(parsed.statements[1]).toMatchObject({
      justification: 'false_positive',
      products: ['pkg:npm/inner@1'],
    });
  });

  it('names the author from the supplier, and the id from the serial alone or the content', () => {
    const supplier = parseVex(
      bytes({
        bomFormat: 'CycloneDX',
        serialNumber: 'urn:uuid:x',
        metadata: { supplier: { name: 'Acme' } },
      }),
    );
    expect(supplier).toMatchObject({ id: 'urn:uuid:x', author: 'Acme', statements: [] });
    const anonymous = bytes({ bomFormat: 'CycloneDX' });
    expect(parseVex(anonymous)).toMatchObject({
      id: `sha256:${createHash('sha256').update(anonymous).digest('hex')}`,
      author: null,
      timestamp: null,
    });
  });

  it('refuses what is not VEX', () => {
    expect(errorCode(() => parseVex(new TextEncoder().encode('nope')))).toBe('malformed');
    expect(errorCode(() => parseVex(bytes(null)))).toBe('malformed');
    expect(errorCode(() => parseVex(bytes({ '@context': 'https://example.com' })))).toBe(
      'unsupported',
    );
    expect(errorCode(() => parseVex(bytes({ '@context': 'https://openvex.dev/ns/v0.2.0' })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseVex(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)))).toBe(
      'too_large',
    );
  });
});

const doc = (id: string, statements: VexDocument['statements']): VexDocument => ({
  id,
  author: null,
  timestamp: null,
  statements,
});

const statement = (
  overrides: Partial<VexDocument['statements'][number]>,
): VexDocument['statements'][number] => ({
  vulnerability: 'CVE-2021-23337',
  aliases: [],
  products: ['pkg:npm/lodash'],
  status: 'not_affected',
  justification: null,
  impact: null,
  ...overrides,
});

const finding = (overrides: Partial<VexFinding>): VexFinding => ({
  fingerprint: 'f1',
  ruleId: 'CVE-2021-23337',
  path: 'pkg:npm/lodash@4.17.21',
  state: 'open',
  ...overrides,
});

describe('applyVex', () => {
  it('accepts a matching open finding with the justification as the reason', () => {
    const decisions = applyVex(
      [finding({})],
      [doc('vex-1', [statement({ justification: 'component_not_present' })])],
    );
    expect(decisions).toEqual([
      {
        fingerprint: 'f1',
        state: 'accepted',
        reason: 'VEX: component_not_present',
        triagedBy: 'vex:vex-1',
      },
    ]);
  });

  it('does nothing when the purl does not match', () => {
    const documents = [
      doc('vex-1', [
        statement({ products: ['pkg:npm/lodash-es'] }),
        statement({ products: ['pkg:pypi/lodash'] }),
        statement({ products: ['pkg:npm/lodash@4.17.20'] }),
        statement({ products: ['not-a-purl'] }),
        statement({ products: ['pkg:npm/lodash@4.17.21'], vulnerability: 'CVE-OTHER' }),
      ]),
    ];
    expect(applyVex([finding({})], documents)).toEqual([]);
    expect(applyVex([finding({ path: null })], documents)).toEqual([]);
    expect(
      applyVex(
        [finding({ path: 'pkg:npm/lodash' })],
        [doc('vex-1', [statement({ products: ['pkg:npm/lodash@4.17.21'] })])],
      ),
    ).toEqual([]);
  });

  it('matches aliases case-insensitively, ignores qualifiers and subpaths, decodes escapes', () => {
    const documents = [
      doc('vex-1', [
        statement({
          vulnerability: 'CVE-OTHER',
          aliases: ['ghsa-35jh-r3h4-6jhm'],
          products: ['pkg:NPM/%40babel/core@7.24.0?repository_url=https://r.example#lib'],
          status: 'fixed',
        }),
      ]),
    ];
    const decisions = applyVex(
      [finding({ ruleId: 'GHSA-35JH-R3H4-6JHM', path: 'pkg:npm/@babel/core@7.24.0' })],
      documents,
    );
    expect(decisions).toEqual([
      { fingerprint: 'f1', state: 'fixed', reason: 'VEX: fixed', triagedBy: 'vex:vex-1' },
    ]);
  });

  it('matches a path that is not a purl by equality', () => {
    expect(
      applyVex(
        [finding({ path: 'pkg:broken' }), finding({ fingerprint: 'f2', path: 'pkg:npm/%E0%A4%A' })],
        [doc('vex-1', [statement({ products: ['pkg:broken', 'pkg:npm/%E0%A4%A'] })])],
      ).map((decision) => decision.fingerprint),
    ).toEqual(['f1', 'f2']);
    const decisions = applyVex(
      [finding({ path: 'urn:cdx:other/1#x' })],
      [doc('vex-1', [statement({ products: ['urn:cdx:other/1#x'], impact: 'Not shipped.' })])],
    );
    expect(decisions[0]?.reason).toBe('VEX: Not shipped.');
    expect(
      applyVex(
        [finding({ path: 'pkg:npm/lodash' })],
        [doc('vex-1', [statement({ products: ['pkg:npm/lodash'] })])],
      )[0]?.reason,
    ).toBe('VEX: not_affected');
  });

  it('lets the latest statement win, so a withdrawn statement re-opens the finding', () => {
    const older = doc('vex-1', [statement({ justification: 'inline_mitigations_already_exist' })]);
    const newer = doc('vex-2', [statement({ status: 'under_investigation' })]);
    expect(
      applyVex([finding({ state: 'accepted', triagedBy: 'vex:vex-1' })], [older, newer]),
    ).toEqual([
      {
        fingerprint: 'f1',
        state: 'open',
        reason: 'VEX: under_investigation',
        triagedBy: 'vex:vex-2',
      },
    ]);
    const affected = doc('vex-3', [statement({ status: 'affected' })]);
    expect(applyVex([finding({ state: 'fixed', triagedBy: 'vex:vex-1' })], [affected])).toEqual([
      { fingerprint: 'f1', state: 'open', reason: 'VEX: affected', triagedBy: 'vex:vex-3' },
    ]);
    // An open finding a VEX statement says is affected is already where it should be.
    expect(applyVex([finding({})], [older, newer])).toEqual([]);
    // Within one document, the later statement is the later word.
    expect(
      applyVex([finding({})], [doc('vex-4', [statement({ status: 'affected' }), statement({})])]),
    ).toHaveLength(1);
  });

  it('never touches a finding a person triaged or a scan fixed', () => {
    const documents = [doc('vex-1', [statement({ status: 'fixed' })])];
    expect(
      applyVex(
        [
          finding({ state: 'accepted', triagedBy: 'user:alice' }),
          finding({ state: 'false_positive', triagedBy: null }),
          finding({ state: 'fixed' }),
        ],
        documents,
      ),
    ).toEqual([]);
  });
});
