import { describe, expect, it } from 'vitest';
import { CanonicalFindingSchema } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES, MAX_SARIF_RESULTS } from './sarif.js';
import { MAX_SBOM_COMPONENTS, parseCycloneDx, parseSpdx, type SbomComponent } from './sbom.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

const LODASH_SHA = 'a'.repeat(64);
const MODEL_SHA = 'b'.repeat(64);

/** The same three packages, written by each format the way its own tools write them. */
const CYCLONEDX = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: 'urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79',
  version: 1,
  metadata: { tools: { components: [{ type: 'application', name: 'syft', version: '1.4.0' }] } },
  components: [
    {
      'bom-ref': 'model-1',
      type: 'machine-learning-model',
      name: 'sentiment',
      version: 'abc123',
      purl: 'pkg:huggingface/acme/sentiment@abc123',
      licenses: [{ license: { id: 'Apache-2.0' } }],
      hashes: [{ alg: 'SHA-256', content: MODEL_SHA.toUpperCase() }],
    },
    {
      'bom-ref': 'lodash-ref',
      type: 'library',
      name: 'lodash',
      version: '4.17.21',
      purl: 'pkg:npm/lodash@4.17.21',
      supplier: { name: 'OpenJS Foundation' },
      licenses: [{ license: { id: 'MIT' } }],
      hashes: [{ alg: 'SHA-256', content: LODASH_SHA }],
      components: [],
    },
    {
      'bom-ref': 'babel',
      type: 'framework',
      name: '@babel/core',
      version: '7.24.0',
      purl: 'pkg:npm/%40babel/core@7.24.0',
      licenses: [{ expression: 'MIT OR (Apache-2.0 WITH LLVM-exception)' }],
    },
  ],
};

const SPDX_2_3 = {
  spdxVersion: 'SPDX-2.3',
  SPDXID: 'SPDXRef-DOCUMENT',
  documentNamespace: 'https://example.com/spdx/app-1',
  packages: [
    {
      SPDXID: 'SPDXRef-lodash',
      name: 'lodash',
      versionInfo: '4.17.21',
      supplier: 'Organization: OpenJS Foundation',
      licenseConcluded: 'MIT',
      licenseDeclared: 'NOASSERTION',
      primaryPackagePurpose: 'LIBRARY',
      checksums: [{ algorithm: 'SHA256', checksumValue: LODASH_SHA }],
      externalRefs: [
        { referenceCategory: 'SECURITY', referenceType: 'cpe23Type', referenceLocator: 'cpe:x' },
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:npm/lodash@4.17.21',
        },
      ],
    },
    {
      SPDXID: 'SPDXRef-babel',
      name: '@babel/core',
      versionInfo: '7.24.0',
      supplier: 'NOASSERTION',
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'MIT OR (Apache-2.0 WITH LLVM-exception)',
      primaryPackagePurpose: 'FRAMEWORK',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE_MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:npm/%40babel/core@7.24.0',
        },
      ],
    },
    {
      SPDXID: 'SPDXRef-model',
      name: 'sentiment',
      versionInfo: 'abc123',
      licenseConcluded: 'Apache-2.0',
      checksums: [{ algorithm: 'SHA256', checksumValue: MODEL_SHA }],
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: 'pkg:huggingface/acme/sentiment@abc123',
        },
      ],
    },
  ],
};

const SPDX_3 = {
  '@context': 'https://spdx.org/rdf/3.0.1/spdx-context.jsonld',
  '@graph': [
    { type: 'CreationInfo', '@id': '_:creationinfo', specVersion: '3.0.1' },
    {
      type: 'SpdxDocument',
      spdxId: 'https://example.com/spdx3/doc',
      creationInfo: '_:creationinfo',
    },
    { type: 'Organization', spdxId: 'urn:org:openjs', name: 'OpenJS Foundation' },
    {
      type: 'software_Package',
      spdxId: 'urn:pkg:lodash',
      name: 'lodash',
      software_packageVersion: '4.17.21',
      software_packageUrl: 'pkg:npm/lodash@4.17.21',
      software_primaryPurpose: 'library',
      suppliedBy: 'urn:org:openjs',
      verifiedUsing: [{ type: 'Hash', algorithm: 'sha256', hashValue: LODASH_SHA }],
    },
    {
      type: 'software_Package',
      spdxId: 'urn:pkg:babel',
      name: '@babel/core',
      software_packageVersion: '7.24.0',
      externalIdentifier: [
        { type: 'ExternalIdentifier', externalIdentifierType: 'cpe23', identifier: 'cpe:x' },
        {
          type: 'ExternalIdentifier',
          externalIdentifierType: 'packageUrl',
          identifier: 'pkg:npm/%40babel/core@7.24.0',
        },
      ],
      software_primaryPurpose: 'framework',
    },
    {
      type: 'ai_AIPackage',
      spdxId: 'urn:pkg:model',
      name: 'sentiment',
      software_packageVersion: 'abc123',
      software_packageUrl: 'pkg:huggingface/acme/sentiment@abc123',
      verifiedUsing: [{ type: 'Hash', algorithm: 'sha256', hashValue: MODEL_SHA }],
    },
    {
      type: 'simplelicensing_LicenseExpression',
      spdxId: 'urn:lic:babel',
      simplelicensing_licenseExpression: 'MIT OR (Apache-2.0 WITH LLVM-exception)',
    },
    {
      type: 'Relationship',
      spdxId: 'urn:rel:1',
      from: 'urn:pkg:lodash',
      relationshipType: 'hasConcludedLicense',
      to: ['https://spdx.org/licenses/MIT'],
    },
    {
      type: 'Relationship',
      spdxId: 'urn:rel:2',
      from: 'urn:pkg:babel',
      relationshipType: 'hasConcludedLicense',
      to: ['https://spdx.org/rdf/3.0.1/terms/Expanded/NoAssertionLicense'],
    },
    {
      type: 'Relationship',
      spdxId: 'urn:rel:3',
      from: 'urn:pkg:babel',
      relationshipType: 'hasDeclaredLicense',
      to: ['urn:lic:babel'],
    },
    {
      type: 'Relationship',
      spdxId: 'urn:rel:4',
      from: 'urn:pkg:model',
      relationshipType: 'hasDeclaredLicense',
      to: ['urn:lic:apache'],
    },
    {
      type: 'expandedlicensing_ListedLicense',
      spdxId: 'urn:lic:apache',
      name: 'Apache License 2.0',
      expandedlicensing_licenseId: 'Apache-2.0',
    },
    {
      type: 'Relationship',
      spdxId: 'urn:rel:5',
      from: 'urn:pkg:lodash',
      relationshipType: 'dependsOn',
      to: ['urn:pkg:babel'],
    },
  ],
};

const withoutRef = (components: readonly SbomComponent[]): Omit<SbomComponent, 'ref'>[] =>
  components.map(({ ref: _ref, ...rest }) => rest);

describe('one inventory, three formats', () => {
  it('CycloneDX 1.6, SPDX 2.3 and SPDX 3.0 describing the same packages read identically', () => {
    const cdx = parseCycloneDx(bytes(CYCLONEDX));
    const spdx2 = parseSpdx(bytes(SPDX_2_3));
    const spdx3 = parseSpdx(bytes(SPDX_3));
    expect(withoutRef(spdx2.components)).toEqual(withoutRef(cdx.components));
    expect(withoutRef(spdx3.components)).toEqual(withoutRef(cdx.components));
    expect(withoutRef(cdx.components)).toEqual([
      {
        name: 'sentiment',
        version: 'abc123',
        purl: 'pkg:huggingface/acme/sentiment@abc123',
        type: 'machine-learning-model',
        licences: ['Apache-2.0'],
        licenceExpression: 'Apache-2.0',
        supplier: null,
        hashes: [{ alg: 'sha256', value: MODEL_SHA }],
      },
      {
        name: '@babel/core',
        version: '7.24.0',
        purl: 'pkg:npm/%40babel/core@7.24.0',
        type: 'framework',
        licences: ['Apache-2.0', 'MIT'],
        licenceExpression: 'MIT OR (Apache-2.0 WITH LLVM-exception)',
        supplier: null,
        hashes: [],
      },
      {
        name: 'lodash',
        version: '4.17.21',
        purl: 'pkg:npm/lodash@4.17.21',
        type: 'library',
        licences: ['MIT'],
        licenceExpression: 'MIT',
        supplier: 'OpenJS Foundation',
        hashes: [{ alg: 'sha256', value: LODASH_SHA }],
      },
    ]);
    expect(cdx).toMatchObject({
      format: 'cyclonedx',
      specVersion: '1.6',
      serial: 'urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79',
      truncated: false,
      findings: [],
      preTriaged: [],
    });
    expect(spdx2).toMatchObject({
      format: 'spdx',
      specVersion: '2.3',
      serial: 'https://example.com/spdx/app-1',
    });
    expect(spdx3).toMatchObject({
      format: 'spdx',
      specVersion: '3.0.1',
      serial: 'https://example.com/spdx3/doc',
    });
    expect(cdx.components.map((component) => component.ref)).toEqual([
      'model-1',
      'babel',
      'lodash-ref',
    ]);
    expect(spdx3.components.map((component) => component.ref)).toEqual([
      'urn:pkg:model',
      'urn:pkg:babel',
      'urn:pkg:lodash',
    ]);
  });

  it('the order a document lists packages in does not change the inventory', () => {
    const reversed = { ...CYCLONEDX, components: [...CYCLONEDX.components].reverse() };
    expect(parseCycloneDx(bytes(reversed)).components).toEqual(
      parseCycloneDx(bytes(CYCLONEDX)).components,
    );
  });
});

describe('parseCycloneDx', () => {
  it('flattens nested components and falls back for missing fields', () => {
    const parsed = parseCycloneDx(
      bytes({
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [
          {
            type: 'application',
            name: 'app',
            components: [
              { name: 'inner', version: '1', licenses: [{ license: { name: 'Custom EULA' } }] },
              'not a component',
              { type: 'library' },
            ],
          },
          {
            name: 'two-ids',
            purl: 'pkg:npm/two-ids@1',
            licenses: [{ license: { id: 'MIT' } }, { license: { id: 'ISC' } }, {}, 3],
            hashes: [{ alg: 'SHA-512' }, { content: 'x' }, { alg: 'SHA3-256', content: 'AB' }],
          },
        ],
      }),
    );
    expect(parsed.serial).toBeNull();
    expect(parsed.components).toEqual([
      {
        ref: 'app',
        name: 'app',
        version: null,
        purl: null,
        type: 'application',
        licences: [],
        licenceExpression: null,
        supplier: null,
        hashes: [],
      },
      {
        ref: 'inner@1',
        name: 'inner',
        version: '1',
        purl: null,
        type: 'library',
        licences: ['Custom EULA'],
        licenceExpression: 'Custom EULA',
        supplier: null,
        hashes: [],
      },
      {
        ref: 'pkg:npm/two-ids@1',
        name: 'two-ids',
        version: null,
        purl: 'pkg:npm/two-ids@1',
        type: 'library',
        licences: ['ISC', 'MIT'],
        licenceExpression: null,
        supplier: null,
        hashes: [{ alg: 'sha3256', value: 'ab' }],
      },
    ]);
  });

  it('turns embedded vulnerabilities into dependency findings, one per affected component', () => {
    const parsed = parseCycloneDx(
      bytes({
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        metadata: { tools: [{ vendor: 'aquasecurity', name: 'Trivy Scanner', version: '0.50.0' }] },
        components: CYCLONEDX.components,
        vulnerabilities: [
          {
            id: 'CVE-2021-23337',
            source: { name: 'NVD', url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337' },
            ratings: [
              { severity: 'medium', method: 'CVSSv31', score: 5 },
              { severity: 'high', method: 'CVSSv31', score: 7.2 },
              { severity: 'none' },
            ],
            description: 'Command injection in template.',
            recommendation: 'Upgrade lodash to 4.17.22',
            affects: [{ ref: 'lodash-ref' }, { ref: 'babel' }],
          },
          {
            id: 'GHSA-xxxx',
            advisories: [{ url: 'https://github.com/advisories/GHSA-xxxx' }],
            ratings: [{ score: 9.8 }],
            detail: 'Detailed only.',
            affects: [
              { ref: 'pkg:npm/outside@1', versions: [{ version: '2', status: 'unaffected' }] },
            ],
          },
          {
            id: 'CVE-2000-0001',
            ratings: [{ severity: 'unknown' }, { score: 'n/a' }],
            analysis: { state: 'exploitable', response: ['can_not_fix'] },
            affects: [{ ref: 'not-a-ref' }],
          },
          {
            id: 'CVE-2000-0002',
            ratings: [{ score: 0.0 }],
            analysis: { state: 'in_triage', response: ['update'] },
          },
          {
            id: 'CVE-2000-0003',
            ratings: [{ score: 2 }, { score: 4.5 }],
            affects: [{ ref: 'model-1', versions: [{ version: 'abc123', status: 'affected' }] }],
          },
          { ratings: [{ severity: 'critical' }] },
          'not an object',
        ],
      }),
    );
    for (const finding of parsed.findings) CanonicalFindingSchema.parse(finding);
    expect(parsed.findings.map((finding) => [finding.ruleId, finding.path])).toEqual([
      ['CVE-2021-23337', 'pkg:npm/lodash@4.17.21'],
      ['CVE-2021-23337', 'pkg:npm/%40babel/core@7.24.0'],
      ['GHSA-xxxx', 'pkg:npm/outside@1'],
      ['CVE-2000-0001', null],
      ['CVE-2000-0002', null],
      ['CVE-2000-0003', 'pkg:huggingface/acme/sentiment@abc123'],
    ]);
    const [lodash, , ghsa, noFix, triage, model] = parsed.findings;
    expect(lodash).toMatchObject({
      tool: 'trivy',
      kind: 'vulnerability',
      dimension: 'dependencies',
      severity: 'high',
      line: null,
      helpUri: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337',
      fixAvailable: true,
      message: 'CVE-2021-23337 in lodash@4.17.21: Command injection in template.',
    });
    expect(ghsa).toMatchObject({
      severity: 'critical',
      fixAvailable: true,
      helpUri: 'https://github.com/advisories/GHSA-xxxx',
      message: 'GHSA-xxxx in pkg:npm/outside@1: Detailed only.',
    });
    expect(noFix).toMatchObject({
      severity: 'info',
      fixAvailable: false,
      helpUri: null,
      message: 'CVE-2000-0001: CVE-2000-0001',
    });
    expect(triage).toMatchObject({ severity: 'info', fixAvailable: true });
    expect(model).toMatchObject({ severity: 'medium', fixAvailable: null });
    expect(parsed.preTriaged).toEqual([]);
  });

  it('keeps fingerprints stable across re-uploads and distinct per component', () => {
    const document = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      components: CYCLONEDX.components,
      vulnerabilities: [{ id: 'CVE-1', affects: [{ ref: 'lodash-ref' }, { ref: 'babel' }] }],
    };
    const first = parseCycloneDx(bytes(document)).findings;
    const second = parseCycloneDx(bytes({ ...document, serialNumber: 'urn:uuid:other' })).findings;
    expect(first.map((finding) => finding.fingerprint)).toEqual(
      second.map((finding) => finding.fingerprint),
    );
    expect(new Set(first.map((finding) => finding.fingerprint)).size).toBe(2);
    expect(first[0]?.tool).toBe('cyclonedx');
  });

  it('emits analysed vulnerabilities and also reports them as pre-triaged', () => {
    const parsed = parseCycloneDx(
      bytes({
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        metadata: { tools: { components: [{ name: 'Grype' }] } },
        components: CYCLONEDX.components,
        vulnerabilities: [
          {
            id: 'CVE-A',
            analysis: { state: 'not_affected', justification: 'code_not_reachable' },
            affects: [{ ref: 'lodash-ref' }],
          },
          {
            id: 'CVE-B',
            analysis: { state: 'false_positive', detail: 'Scanner matched the wrong package.' },
            affects: [{ ref: 'babel' }],
          },
          { id: 'CVE-C', analysis: { state: 'resolved' }, affects: [{ ref: 'model-1' }] },
          {
            id: 'CVE-D',
            analysis: { state: 'resolved_with_pedigree', response: ['will_not_fix'] },
          },
        ],
      }),
    );
    expect(parsed.findings).toHaveLength(4);
    expect(parsed.findings[0]?.tool).toBe('grype');
    expect(parsed.findings[3]?.fixAvailable).toBe(false);
    expect(parsed.preTriaged).toEqual([
      {
        fingerprint: parsed.findings[0]?.fingerprint,
        state: 'accepted',
        reason: 'CycloneDX analysis not_affected: code_not_reachable',
      },
      {
        fingerprint: parsed.findings[1]?.fingerprint,
        state: 'false_positive',
        reason: 'CycloneDX analysis false_positive: Scanner matched the wrong package.',
      },
      {
        fingerprint: parsed.findings[2]?.fingerprint,
        state: 'fixed',
        reason: 'CycloneDX analysis resolved: no justification given',
      },
      {
        fingerprint: parsed.findings[3]?.fingerprint,
        state: 'fixed',
        reason: 'CycloneDX analysis resolved_with_pedigree: no justification given',
      },
    ]);
  });

  it('truncates long text deliberately so every finding fits the contract', () => {
    const parsed = parseCycloneDx(
      bytes({
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        vulnerabilities: [
          {
            id: 'X'.repeat(500),
            description: 'd'.repeat(5000),
            source: { url: `https://example.com/${'u'.repeat(3000)}` },
            affects: [{ ref: `pkg:npm/${'p'.repeat(2000)}` }],
          },
        ],
      }),
    );
    const [finding] = parsed.findings;
    expect(CanonicalFindingSchema.parse(finding)).toBeDefined();
    expect(finding?.ruleId).toHaveLength(300);
    expect(finding?.message).toHaveLength(4000);
    expect(finding?.path).toHaveLength(1000);
    expect(finding?.helpUri).toHaveLength(2000);
  });

  it('caps components and findings with a truncated flag rather than dropping silently', () => {
    const components = Array.from({ length: MAX_SBOM_COMPONENTS + 1 }, (_, index) => ({
      name: `c${String(index)}`,
    }));
    const many = parseCycloneDx(bytes({ bomFormat: 'CycloneDX', specVersion: '1.6', components }));
    expect(many.components).toHaveLength(MAX_SBOM_COMPONENTS);
    expect(many.truncated).toBe(true);

    const vulnerabilities = Array.from({ length: MAX_SARIF_RESULTS + 1 }, (_, index) => ({
      id: `CVE-${String(index)}`,
    }));
    const vulns = parseCycloneDx(
      bytes({ bomFormat: 'CycloneDX', specVersion: '1.6', vulnerabilities }),
    );
    expect(vulns.findings).toHaveLength(MAX_SARIF_RESULTS);
    expect(vulns.truncated).toBe(true);
  });

  it('orders equal purls and names by version then ref, and hashes by algorithm then value', () => {
    const parsed = parseCycloneDx(
      bytes({
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        components: [
          { 'bom-ref': 'z', name: 'same', version: '2' },
          { 'bom-ref': 'w2', name: 'bare' },
          { 'bom-ref': 'w1', name: 'bare' },
          { 'bom-ref': 'y', name: 'same', version: '1' },
          { 'bom-ref': 'x', name: 'same', version: '1' },
          {
            'bom-ref': 'h',
            name: 'hashed',
            hashes: [
              { alg: 'SHA-256', content: 'bb' },
              { alg: 'SHA-1', content: 'ff' },
              { alg: 'SHA-256', content: 'aa' },
              { alg: 'SHA-256', content: 'aa' },
            ],
          },
        ],
        vulnerabilities: [
          {
            id: 'CVE-HIGH',
            ratings: [{ score: 7.5 }],
            affects: [{}, { ref: 'x' }, { ref: 'x' }],
          },
        ],
      }),
    );
    expect(parsed.components.map((component) => component.ref)).toEqual([
      'w1',
      'w2',
      'h',
      'x',
      'y',
      'z',
    ]);
    expect(parsed.components[2]?.hashes).toEqual([
      { alg: 'sha1', value: 'ff' },
      { alg: 'sha256', value: 'aa' },
      { alg: 'sha256', value: 'aa' },
      { alg: 'sha256', value: 'bb' },
    ]);
    expect(parsed.findings.map((finding) => [finding.path, finding.severity])).toEqual([
      [null, 'high'],
      ['x', 'high'],
    ]);
    expect(parsed.findings[1]?.message).toBe('CVE-HIGH in same@1: CVE-HIGH');
  });

  it('refuses what is not a CycloneDX BOM', () => {
    expect(errorCode(() => parseCycloneDx(new TextEncoder().encode('{nope')))).toBe('malformed');
    expect(errorCode(() => parseCycloneDx(bytes([1])))).toBe('malformed');
    expect(errorCode(() => parseCycloneDx(bytes({ specVersion: '1.6' })))).toBe('malformed');
    expect(errorCode(() => parseCycloneDx(bytes({ bomFormat: 'CycloneDX' })))).toBe('malformed');
    expect(errorCode(() => parseCycloneDx(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)))).toBe(
      'too_large',
    );
  });
});

describe('parseSpdx', () => {
  it('reads SPDX 2.3 suppliers, purposes and licences, ignoring NOASSERTION and NONE', () => {
    const parsed = parseSpdx(
      bytes({
        spdxVersion: 'SPDX-2.2',
        packages: [
          {
            SPDXID: 'SPDXRef-a',
            name: 'a',
            supplier: 'Person: Jane Doe (jane@example.com)',
            licenseConcluded: 'NONE',
            licenseDeclared: 'NONE',
            primaryPackagePurpose: 'OPERATING-SYSTEM',
            checksums: [{ algorithm: 'SHA1' }, 'x'],
            externalRefs: [{ referenceType: 'purl' }],
          },
          { name: 'b', licenseConcluded: 'LicenseRef-custom' },
          { SPDXID: 'SPDXRef-nameless' },
          'not a package',
        ],
      }),
    );
    expect(parsed.serial).toBeNull();
    expect(parsed.specVersion).toBe('2.2');
    expect(parsed.components).toEqual([
      {
        ref: 'SPDXRef-a',
        name: 'a',
        version: null,
        purl: null,
        type: 'operating-system',
        licences: [],
        licenceExpression: null,
        supplier: 'Jane Doe (jane@example.com)',
        hashes: [],
      },
      {
        ref: 'b',
        name: 'b',
        version: null,
        purl: null,
        type: 'library',
        licences: ['LicenseRef-custom'],
        licenceExpression: 'LicenseRef-custom',
        supplier: null,
        hashes: [],
      },
    ]);
  });

  it('reads SPDX 3.0 purposes, agents and licences that are not in the graph', () => {
    const parsed = parseSpdx(
      bytes({
        '@context': ['https://spdx.org/rdf/3.0.1/spdx-context.jsonld'],
        '@graph': [
          {
            '@type': 'software_Package',
            '@id': 'urn:a',
            name: 'a',
            software_primaryPurpose: 'operatingSystem',
            suppliedBy: 'urn:missing-agent',
          },
          {
            type: 'software_Package',
            spdxId: 'urn:b',
            name: 'b',
            software_primaryPurpose: 'model',
            originatedBy: ['urn:x'],
            verifiedUsing: [{ type: 'Hash' }, { type: 'PackageVerificationCode' }],
          },
          { type: 'software_Package', spdxId: 'urn:nameless' },
          { type: 'Relationship', from: 'urn:a', relationshipType: 'hasConcludedLicense' },
          {
            type: 'Relationship',
            from: 'urn:b',
            relationshipType: 'hasConcludedLicense',
            to: ['urn:unknown-licence'],
          },
          {
            type: 'Relationship',
            from: 'urn:a',
            relationshipType: 'hasDeclaredLicense',
            to: ['https://spdx.org/rdf/3.0.1/terms/Expanded/NoneLicense'],
          },
          'not an element',
        ],
      }),
    );
    expect(parsed.specVersion).toBe('3.0.1');
    expect(parsed.serial).toBeNull();
    expect(parsed.components).toEqual([
      {
        ref: 'urn:a',
        name: 'a',
        version: null,
        purl: null,
        type: 'operating-system',
        licences: [],
        licenceExpression: null,
        supplier: null,
        hashes: [],
      },
      {
        ref: 'urn:b',
        name: 'b',
        version: null,
        purl: null,
        type: 'machine-learning-model',
        licences: ['urn:unknown-licence'],
        licenceExpression: 'urn:unknown-licence',
        supplier: null,
        hashes: [],
      },
    ]);
  });

  it('joins several licence targets with AND and reads a mixed context array', () => {
    const parsed = parseSpdx(
      bytes({
        '@context': [
          { ex: 'https://example.com/' },
          'https://spdx.org/rdf/3.0.1/spdx-context.jsonld',
        ],
        '@graph': [
          { type: 'CreationInfo', '@id': '_:ci' },
          { type: 'software_Package', spdxId: 'urn:a', name: 'a' },
          { type: 'Relationship', from: 'urn:a', to: ['urn:x'] },
          {
            type: 'Relationship',
            from: 'urn:a',
            relationshipType: 'hasDeclaredLicense',
            to: [
              'https://spdx.org/licenses/MIT',
              7,
              'urn:custom',
              'https://spdx.org/licenses/BSD-3-Clause',
            ],
          },
          {
            type: 'expandedlicensing_CustomLicense',
            spdxId: 'urn:custom',
          },
        ],
      }),
    );
    expect(parsed.specVersion).toBe('3.0.1');
    expect(parsed.components[0]).toMatchObject({
      licences: ['BSD-3-Clause', 'MIT', 'urn:custom'],
      licenceExpression: '(MIT) AND (urn:custom) AND (BSD-3-Clause)',
    });
  });

  it('caps SPDX packages with the same flag', () => {
    const packages = Array.from({ length: MAX_SBOM_COMPONENTS + 1 }, (_, index) => ({
      name: `p${String(index)}`,
    }));
    const parsed = parseSpdx(bytes({ spdxVersion: 'SPDX-2.3', packages }));
    expect(parsed.components).toHaveLength(MAX_SBOM_COMPONENTS);
    expect(parsed.truncated).toBe(true);
    const graph = parseSpdx(
      bytes({
        '@context': 'https://spdx.org/rdf/3.0.0/spdx-context.jsonld',
        '@graph': packages.map((element) => ({
          type: 'software_Package',
          spdxId: `urn:${element.name}`,
          ...element,
        })),
      }),
    );
    expect(graph.truncated).toBe(true);
  });

  it('refuses a document that is neither SPDX 2 nor SPDX 3', () => {
    expect(errorCode(() => parseSpdx(bytes({ spdxVersion: 'SPDX-1.2', packages: [] })))).toBe(
      'unsupported',
    );
    expect(errorCode(() => parseSpdx(bytes({ spdxVersion: 'SPDX-2.3' })))).toBe('malformed');
    expect(
      errorCode(() => parseSpdx(bytes({ '@context': 'https://example.com', '@graph': [] }))),
    ).toBe('unsupported');
    expect(errorCode(() => parseSpdx(bytes({ '@graph': {} })))).toBe('malformed');
    expect(errorCode(() => parseSpdx(bytes({ bomFormat: 'CycloneDX' })))).toBe('malformed');
    expect(errorCode(() => parseSpdx(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)))).toBe(
      'too_large',
    );
  });
});
