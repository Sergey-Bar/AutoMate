import { generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DimensionMetricSchema } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import {
  dssePae,
  parseProvenance,
  provenanceMetric,
  verifyProvenance,
  type ParsedProvenance,
} from './provenance.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));
const b64 = (data: Uint8Array | string): string => Buffer.from(data).toString('base64');

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

const DIGEST = 'c'.repeat(64);
const BUILDER =
  'https://github.com/slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@refs/tags/v2.0.0';
const PAYLOAD_TYPE = 'application/vnd.in-toto+json';

const slsaV1 = (builderId = BUILDER, digest = DIGEST): Record<string, unknown> => ({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: 'app.tar.gz', digest: { sha256: digest, sha512: 'd'.repeat(128), bad: 3 } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
    },
    runDetails: { builder: { id: builderId }, metadata: { invocationId: 'run-42' } },
  },
});

const slsaV02 = {
  _type: 'https://in-toto.io/Statement/v0.1',
  subject: [{ digest: { sha256: DIGEST } }, { name: 'bare' }, 'junk'],
  predicateType: 'https://slsa.dev/provenance/v0.2',
  predicate: {
    builder: { id: 'https://cloudbuild.googleapis.com/GoogleHostedWorker' },
    buildType: 'https://cloudbuild.googleapis.com/CloudBuildYaml@v0.1',
    metadata: { buildInvocationId: 'build-7' },
  },
};

const pem = (key: KeyObject): string => key.export({ type: 'spki', format: 'pem' }).toString();

/** The DSSE v1 pre-authentication encoding, written out independently of the module under test. */
function pae(type: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${String(Buffer.byteLength(type))} ${type} ${String(body.length)} `),
    body,
  ]);
}

const SIGNING_DIGEST: Readonly<Record<string, string>> = {
  secp384r1: 'sha384',
  secp521r1: 'sha512',
};

function signPae(key: KeyObject, type: string, body: Buffer): Buffer {
  const algorithm =
    key.asymmetricKeyType === 'ed25519'
      ? null
      : (SIGNING_DIGEST[key.asymmetricKeyDetails?.namedCurve ?? ''] ?? 'sha256');
  return sign(algorithm, pae(type, body), key);
}

function envelope(
  statement: unknown,
  key: KeyObject,
  keyid: string | null = 'key-1',
): Record<string, unknown> {
  const body = Buffer.from(JSON.stringify(statement));
  return {
    payloadType: PAYLOAD_TYPE,
    payload: b64(body),
    signatures: [
      { ...(keyid === null ? {} : { keyid }), sig: b64(signPae(key, PAYLOAD_TYPE, body)) },
    ],
  };
}

// ─── A minimal X.509 writer: just enough DER for a CA, an intermediate and a leaf ──────────

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  return Buffer.from([0x82, length >> 8, length & 0xff]);
}
const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
};
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, ...parts);
function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const out = [first * 40 + second];
  for (const value of rest) {
    const chunk = [value & 0x7f];
    for (let remaining = value >> 7; remaining > 0; remaining >>= 7)
      chunk.unshift((remaining & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
const name = (cn: string): Buffer =>
  seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))));
function utcTime(date: Date): Buffer {
  const iso = date.toISOString();
  return tlv(
    0x17,
    Buffer.from(
      `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`,
    ),
  );
}
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

interface Issued {
  cert: X509Certificate;
  key: KeyObject;
  pem: string;
  der: Buffer;
}

/** A Fulcio-style identity: a SAN (URI or email) and the OIDC issuer extension. */
interface Identity {
  uri?: string;
  email?: string;
  /** The OIDC issuer, as the legacy raw-string extension (.1.1) or the DER one (.1.8). */
  issuer?: { value: string; form: 'legacy' | 'der' };
}

/** The SAN extension: GeneralNames with a [6] uniformResourceIdentifier and/or [1] rfc822Name. */
function sanExtension(identity: Identity): Buffer[] {
  const names = [
    ...(identity.uri === undefined ? [] : [tlv(0x86, Buffer.from(identity.uri))]),
    ...(identity.email === undefined ? [] : [tlv(0x81, Buffer.from(identity.email))]),
  ];
  return names.length === 0 ? [] : [seq(oid('2.5.29.17'), tlv(0x04, seq(...names)))];
}

function issuerExtension(identity: Identity): Buffer[] {
  if (identity.issuer === undefined) return [];
  const { value, form } = identity.issuer;
  return form === 'legacy'
    ? [seq(oid('1.3.6.1.4.1.57264.1.1'), tlv(0x04, Buffer.from(value)))]
    : [seq(oid('1.3.6.1.4.1.57264.1.8'), tlv(0x04, tlv(0x0c, Buffer.from(value))))];
}

let serial = 1;
function certificate(
  subject: string,
  issuer: { name: string; key: KeyObject } | null,
  options: { ca: boolean; from?: Date; to?: Date; identity?: Identity },
): Issued {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  serial += 1;
  const basicConstraints = seq(
    oid('2.5.29.19'),
    tlv(0x01, Buffer.from([0xff])),
    tlv(0x04, options.ca ? seq(tlv(0x01, Buffer.from([0xff]))) : seq()),
  );
  const identity = options.identity ?? {};
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, Buffer.from([serial])),
    ECDSA_SHA256,
    name(issuer?.name ?? subject),
    seq(
      utcTime(options.from ?? new Date('2024-01-01T00:00:00Z')),
      utcTime(options.to ?? new Date('2034-01-01T00:00:00Z')),
    ),
    name(subject),
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(basicConstraints, ...sanExtension(identity), ...issuerExtension(identity))),
  );
  const signature = sign('sha256', tbs, issuer?.key ?? privateKey);
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.from([0]), signature));
  const cert = new X509Certificate(der);
  return { cert, key: privateKey, pem: cert.toString(), der };
}

const AT = new Date('2025-06-01T00:00:00Z');
const WORKFLOW = 'https://github.com/octo/app/.github/workflows/release.yml@refs/heads/main';
const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
const TRUSTED = [{ subject: WORKFLOW, issuer: GITHUB_ISSUER }];
const DIRECT_IDENTITY = [{ subject: 'direct@example.com' }];
const root = certificate('Test Root', null, { ca: true });
const intermediate = certificate(
  'Test Intermediate',
  { name: 'Test Root', key: root.key },
  { ca: true },
);
const leaf = certificate(
  'signer@example.com',
  { name: 'Test Intermediate', key: intermediate.key },
  { ca: false, identity: { uri: WORKFLOW, issuer: { value: GITHUB_ISSUER, form: 'der' } } },
);
const directLeaf = certificate(
  'direct@example.com',
  { name: 'Test Root', key: root.key },
  {
    ca: false,
    identity: {
      email: 'direct@example.com',
      issuer: { value: 'https://accounts.example.com', form: 'legacy' },
    },
  },
);
/** Anyone the same CA will issue a certificate to: a valid chain, the wrong identity. */
const strangerLeaf = certificate(
  'stranger',
  { name: 'Test Root', key: root.key },
  {
    ca: false,
    identity: {
      uri: 'https://github.com/evil/app/.github/workflows/release.yml@refs/heads/main',
      issuer: { value: GITHUB_ISSUER, form: 'der' },
    },
  },
);
const anonymousLeaf = certificate('anonymous', { name: 'Test Root', key: root.key }, { ca: false });
const otherRoot = certificate('Other Root', null, { ca: true });
const expiredLeaf = certificate(
  'old@example.com',
  { name: 'Test Root', key: root.key },
  {
    ca: false,
    from: new Date('2020-01-01T00:00:00Z'),
    to: new Date('2021-01-01T00:00:00Z'),
  },
);
const notYetRoot = certificate('Future Root', null, {
  ca: true,
  from: new Date('2030-01-01T00:00:00Z'),
});
const futureLeaf = certificate(
  'future@example.com',
  { name: 'Future Root', key: notYetRoot.key },
  { ca: false },
);

function bundle(
  statement: unknown,
  signer: Issued,
  material: Record<string, unknown> = { certificate: { rawBytes: b64(signer.der) } },
): Uint8Array {
  return bytes({
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { ...material, tlogEntries: [{ integratedTime: '1717200000' }] },
    dsseEnvelope: envelope(statement, signer.key, null),
  });
}

const ecKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const edKeys = generateKeyPairSync('ed25519');

describe('dssePae', () => {
  it('is the DSSE v1 pre-authentication encoding, lengths in bytes', () => {
    const body = Buffer.from('héllo');
    expect(Buffer.from(dssePae('application/x', body)).toString()).toBe(
      'DSSEv1 13 application/x 6 héllo',
    );
  });
});

describe('parseProvenance', () => {
  it('reads a raw SLSA v1 statement: subjects, builder, build type, invocation', () => {
    const parsed = parseProvenance(bytes(slsaV1()));
    expect(parsed).toEqual({
      statement: {
        subjects: [{ name: 'app.tar.gz', digests: { sha256: DIGEST, sha512: 'd'.repeat(128) } }],
        predicateType: 'https://slsa.dev/provenance/v1',
        builderId: BUILDER,
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        invocationId: 'run-42',
      },
      envelope: null,
      certificatePem: null,
      chainPems: [],
      integratedTime: null,
    });
  });

  it('reads SLSA v0.2 and statements with sparse fields', () => {
    expect(parseProvenance(bytes(slsaV02)).statement).toEqual({
      subjects: [
        { name: '', digests: { sha256: DIGEST } },
        { name: 'bare', digests: {} },
      ],
      predicateType: 'https://slsa.dev/provenance/v0.2',
      builderId: 'https://cloudbuild.googleapis.com/GoogleHostedWorker',
      buildType: 'https://cloudbuild.googleapis.com/CloudBuildYaml@v0.1',
      invocationId: 'build-7',
    });
    expect(
      parseProvenance(
        bytes({
          _type: 'https://in-toto.io/Statement/v1',
          subject: [],
          predicateType: 'https://example.com/x',
        }),
      ).statement,
    ).toEqual({
      subjects: [],
      predicateType: 'https://example.com/x',
      builderId: null,
      buildType: null,
      invocationId: null,
    });
  });

  it('decodes a DSSE envelope, keeping the payload bytes and every signature', () => {
    const signed = envelope(slsaV1(), ecKeys.privateKey);
    const parsed = parseProvenance(
      bytes({ ...signed, signatures: [...(signed['signatures'] as unknown[]), 'junk'] }),
    );
    expect(parsed.statement.builderId).toBe(BUILDER);
    expect(parsed.envelope?.payloadType).toBe(PAYLOAD_TYPE);
    expect(Buffer.from(parsed.envelope?.payload ?? []).toString()).toBe(JSON.stringify(slsaV1()));
    expect(parsed.envelope?.signatures).toHaveLength(1);
    expect(parsed.envelope?.signatures[0]?.keyid).toBe('key-1');
  });

  it('reads Sigstore bundle certificates, from v0.3 certificate and v0.1 chains', () => {
    const v03 = parseProvenance(bundle(slsaV1(), leaf));
    expect(v03.certificatePem).toBe(leaf.pem);
    expect(v03.chainPems).toEqual([]);
    expect(v03.integratedTime).toBe('2024-06-01T00:00:00.000Z');
    const v01 = parseProvenance(
      bundle(slsaV1(), leaf, {
        x509CertificateChain: {
          certificates: [{ rawBytes: b64(leaf.der) }, { rawBytes: b64(intermediate.der) }, {}],
        },
      }),
    );
    expect(v01.certificatePem).toBe(leaf.pem);
    expect(v01.chainPems).toEqual([intermediate.pem]);
    const keyOnly = parseProvenance(bundle(slsaV1(), leaf, { publicKey: { hint: 'abc' } }));
    expect(keyOnly).toMatchObject({ certificatePem: null, chainPems: [] });
    const noTime = parseProvenance(
      bytes({
        verificationMaterial: { tlogEntries: [{ integratedTime: 'soon' }] },
        dsseEnvelope: envelope(slsaV1(), leaf.key),
      }),
    );
    expect(noTime.integratedTime).toBeNull();
    const numeric = parseProvenance(
      bytes({
        verificationMaterial: { tlogEntries: [{ integratedTime: 1717200000 }] },
        dsseEnvelope: envelope(slsaV1(), leaf.key),
      }),
    );
    expect(numeric.integratedTime).toBe('2024-06-01T00:00:00.000Z');
  });

  it('refuses what is not provenance, saying which way it is wrong', () => {
    const good = envelope(slsaV1(), ecKeys.privateKey);
    expect(errorCode(() => parseProvenance(new TextEncoder().encode('{')))).toBe('malformed');
    expect(errorCode(() => parseProvenance(bytes('a string')))).toBe('malformed');
    expect(errorCode(() => parseProvenance(bytes({ hello: 'world' })))).toBe('unsupported');
    expect(
      errorCode(() => parseProvenance(bytes({ messageSignature: {}, verificationMaterial: {} }))),
    ).toBe('unsupported');
    expect(errorCode(() => parseProvenance(bytes({ ...good, payloadType: 'text/plain' })))).toBe(
      'unsupported',
    );
    expect(errorCode(() => parseProvenance(bytes({ ...good, payload: '***' })))).toBe('malformed');
    expect(errorCode(() => parseProvenance(bytes({ ...good, payload: 7 })))).toBe('malformed');
    expect(errorCode(() => parseProvenance(bytes({ ...good, payload: b64('not json') })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseProvenance(bytes({ ...good, signatures: [{ sig: '!!' }] })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseProvenance(bytes({ ...good, signatures: 'x' })))).toBe('malformed');
    expect(
      errorCode(() => parseProvenance(bytes({ _type: 'https://example.com/Statement' }))),
    ).toBe('unsupported');
    expect(
      errorCode(() =>
        parseProvenance(bytes({ _type: 'https://in-toto.io/Statement/v1', subject: [] })),
      ),
    ).toBe('malformed');
    expect(
      errorCode(() =>
        parseProvenance(bytes({ _type: 'https://in-toto.io/Statement/v1', predicateType: 'x' })),
      ),
    ).toBe('malformed');
    expect(
      errorCode(() =>
        parseProvenance(
          bytes({ verificationMaterial: { certificate: { rawBytes: '%%' } }, dsseEnvelope: good }),
        ),
      ),
    ).toBe('malformed');
    expect(errorCode(() => parseProvenance(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)))).toBe(
      'too_large',
    );
  });
});

describe('verifyProvenance', () => {
  const signedBy = (key: KeyObject, statement: unknown = slsaV1()): ParsedProvenance =>
    parseProvenance(bytes(envelope(statement, key)));

  const BOUND = [{ alg: 'sha256', value: DIGEST }];

  it('verifies a P-256 signature against a configured key: SLSA L2, L3 with an allowed builder', () => {
    const parsed = signedBy(ecKeys.privateKey);
    const result = verifyProvenance(parsed, {
      trustedKeysPem: [pem(ecKeys.publicKey)],
      expectedDigests: BOUND,
    });
    expect(result).toEqual({
      subjectMatches: true,
      builderAllowed: null,
      signature: 'verified',
      chain: 'absent',
      transparencyLog: 'not_checked',
      slsaLevel: 2,
      reasons: [
        'no builder allow-list configured, so SLSA level 3 cannot be claimed',
        'the transparency log (Rekor) is not checked',
      ],
    });
    const level3 = verifyProvenance(parsed, {
      trustedKeysPem: [pem(ecKeys.publicKey)],
      allowedBuilders: [BUILDER],
      expectedDigests: [{ alg: 'SHA256', value: DIGEST.toUpperCase() }],
    });
    expect(level3).toMatchObject({
      subjectMatches: true,
      builderAllowed: true,
      signature: 'verified',
      slsaLevel: 3,
    });
  });

  it('caps a verified provenance at L1 when no expected digest binds it to the artifact', () => {
    const result = verifyProvenance(signedBy(ecKeys.privateKey), {
      trustedKeysPem: [pem(ecKeys.publicKey)],
      allowedBuilders: [BUILDER],
    });
    expect(result).toMatchObject({
      subjectMatches: null,
      signature: 'verified',
      builderAllowed: true,
      slsaLevel: 1,
    });
    expect(result.reasons).toContain(
      'no expected artifact digest was given, so the provenance is not bound to the artifact and is held at SLSA level 1',
    );
  });

  it('verifies ed25519, P-384 and RSA signatures', () => {
    expect(
      verifyProvenance(signedBy(edKeys.privateKey), { trustedKeysPem: [pem(edKeys.publicKey)] })
        .signature,
    ).toBe('verified');
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' });
    expect(
      verifyProvenance(signedBy(p384.privateKey), { trustedKeysPem: [pem(p384.publicKey)] })
        .signature,
    ).toBe('verified');
    const p521 = generateKeyPairSync('ec', { namedCurve: 'P-521' });
    expect(
      verifyProvenance(signedBy(p521.privateKey), { trustedKeysPem: [pem(p521.publicKey)] })
        .signature,
    ).toBe('verified');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      verifyProvenance(signedBy(rsa.privateKey), { trustedKeysPem: [pem(rsa.publicKey)] })
        .signature,
    ).toBe('verified');
  });

  it('refuses a tampered payload', () => {
    const signed = envelope(slsaV1(), ecKeys.privateKey);
    const tampered = parseProvenance(
      bytes({ ...signed, payload: b64(JSON.stringify(slsaV1('https://evil.example/builder'))) }),
    );
    const result = verifyProvenance(tampered, {
      trustedKeysPem: [pem(ecKeys.publicKey)],
      allowedBuilders: [BUILDER],
    });
    expect(result).toMatchObject({ signature: 'invalid', builderAllowed: false, slsaLevel: 1 });
    expect(result.reasons).toContain('no signature verifies against the configured trust');
  });

  it('refuses a signature from a key that is not trusted, and survives keys that cannot verify', () => {
    const x25519 = generateKeyPairSync('x25519');
    const result = verifyProvenance(signedBy(ecKeys.privateKey), {
      trustedKeysPem: [pem(edKeys.publicKey), pem(x25519.publicKey), 'not a key'],
    });
    expect(result.signature).toBe('invalid');
    expect(result.reasons).toContain('trusted key 3 is not a public key');
  });

  it('puts provenance for another artifact at level 0', () => {
    const result = verifyProvenance(signedBy(ecKeys.privateKey, slsaV1(BUILDER, 'e'.repeat(64))), {
      trustedKeysPem: [pem(ecKeys.publicKey)],
      allowedBuilders: [BUILDER],
      expectedDigests: [{ alg: 'sha256', value: DIGEST }],
    });
    expect(result).toMatchObject({
      subjectMatches: false,
      signature: 'verified',
      builderAllowed: true,
      slsaLevel: 0,
    });
    expect(result.reasons).toContain('no subject carries the expected digest sha256:' + DIGEST);
  });

  it('reports a builder that is not on the allow-list', () => {
    const result = verifyProvenance(
      signedBy(ecKeys.privateKey, slsaV1('https://example.com/my-laptop')),
      {
        trustedKeysPem: [pem(ecKeys.publicKey)],
        allowedBuilders: [BUILDER],
        expectedDigests: BOUND,
      },
    );
    expect(result).toMatchObject({ builderAllowed: false, slsaLevel: 2 });
    expect(result.reasons).toContain(
      'builder https://example.com/my-laptop is not on the allow-list',
    );
    const unnamed = verifyProvenance(parseProvenance(bytes(slsaV02)), { allowedBuilders: [] });
    expect(unnamed.builderAllowed).toBe(false);
  });

  it('never says verified when no trust is configured', () => {
    const result = verifyProvenance(signedBy(ecKeys.privateKey), {});
    expect(result).toMatchObject({ signature: 'not_configured', chain: 'absent', slsaLevel: 1 });
    expect(result.reasons).toContain(
      'no trusted keys or roots configured, so the signature was not checked',
    );
    expect(
      verifyProvenance(parseProvenance(bundle(slsaV1(), leaf)), {
        trustedKeysPem: [],
        trustedRootsPem: [],
      }),
    ).toMatchObject({
      signature: 'not_configured',
      chain: 'not_configured',
      slsaLevel: 1,
    });
  });

  it('calls unsigned provenance unsigned', () => {
    expect(
      verifyProvenance(parseProvenance(bytes(slsaV1())), {
        trustedKeysPem: [pem(ecKeys.publicKey)],
      }),
    ).toMatchObject({
      signature: 'unsigned',
      slsaLevel: 1,
    });
    const empty = { ...envelope(slsaV1(), ecKeys.privateKey), signatures: [] };
    expect(verifyProvenance(parseProvenance(bytes(empty)), {}).signature).toBe('unsigned');
  });

  it('gives a statement that is not SLSA provenance level 0', () => {
    const other = { ...slsaV1(), predicateType: 'https://spdx.dev/Document' };
    const result = verifyProvenance(signedBy(ecKeys.privateKey, other), {
      trustedKeysPem: [pem(ecKeys.publicKey)],
    });
    expect(result).toMatchObject({ signature: 'verified', slsaLevel: 0 });
    expect(result.reasons).toContain('predicate https://spdx.dev/Document is not SLSA provenance');
  });

  it('verifies a Sigstore bundle signature through its certificate chain to a trusted root', () => {
    const viaChain = parseProvenance(
      bundle(slsaV1(), leaf, {
        x509CertificateChain: {
          certificates: [{ rawBytes: b64(leaf.der) }, { rawBytes: b64(intermediate.der) }],
        },
      }),
    );
    expect(
      verifyProvenance(viaChain, {
        trustedRootsPem: [root.pem],
        trustedIdentities: TRUSTED,
        at: AT,
        allowedBuilders: [BUILDER],
        expectedDigests: BOUND,
      }),
    ).toMatchObject({
      signature: 'verified',
      chain: 'verified',
      slsaLevel: 3,
    });
    const direct = parseProvenance(bundle(slsaV1(), directLeaf));
    expect(
      verifyProvenance(direct, {
        trustedRootsPem: ['garbage', root.pem],
        trustedIdentities: DIRECT_IDENTITY,
        at: AT,
      }),
    ).toMatchObject({
      signature: 'verified',
      chain: 'verified',
      reasons: [
        'trusted root 1 is not a certificate',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ],
    });
    // A leaf that is itself configured as a trust anchor.
    expect(verifyProvenance(direct, { trustedRootsPem: [directLeaf.pem], at: AT }).chain).toBe(
      'verified',
    );
  });

  it('counts a root-chained certificate only when its identity is trusted', () => {
    const viaChain = (signer: Issued) =>
      parseProvenance(
        bundle(slsaV1(), signer, {
          x509CertificateChain: {
            certificates: [{ rawBytes: b64(signer.der) }, { rawBytes: b64(intermediate.der) }],
          },
        }),
      );
    const policy = {
      trustedRootsPem: [root.pem],
      at: AT,
      allowedBuilders: [BUILDER],
      expectedDigests: BOUND,
    };
    // Anyone the CA issues to chains; only the configured workflow is trusted.
    const stranger = verifyProvenance(viaChain(strangerLeaf), {
      ...policy,
      trustedIdentities: TRUSTED,
    });
    expect(stranger).toMatchObject({ chain: 'verified', signature: 'invalid', slsaLevel: 1 });
    expect(stranger.reasons).toContain(
      'certificate identity https://github.com/evil/app/.github/workflows/release.yml@refs/heads/main is not trusted',
    );
    // The right subject from the wrong OIDC issuer is not the trusted identity either.
    const wrongIssuer = verifyProvenance(viaChain(leaf), {
      ...policy,
      trustedIdentities: [{ subject: WORKFLOW, issuer: 'https://accounts.google.com' }],
    });
    expect(wrongIssuer.signature).toBe('invalid');
    expect(wrongIssuer.reasons).toContain(`certificate identity ${WORKFLOW} is not trusted`);
    // The issuer is read from the legacy extension too, and is optional in the policy.
    const direct = parseProvenance(bundle(slsaV1(), directLeaf));
    for (const trustedIdentities of [
      [{ subject: 'direct@example.com', issuer: 'https://accounts.example.com' }],
      DIRECT_IDENTITY,
    ]) {
      expect(verifyProvenance(direct, { ...policy, trustedIdentities }).signature).toBe('verified');
    }
    // A certificate with no SAN has no identity to trust.
    const anonymous = verifyProvenance(parseProvenance(bundle(slsaV1(), anonymousLeaf)), {
      ...policy,
      trustedIdentities: TRUSTED,
    });
    expect(anonymous.signature).toBe('invalid');
    expect(anonymous.reasons).toContain('certificate identity (no SAN) is not trusted');
  });

  it('does not check a certificate signature under roots with no identity policy; keys still work', () => {
    const viaChain = parseProvenance(
      bundle(slsaV1(), leaf, {
        x509CertificateChain: {
          certificates: [{ rawBytes: b64(leaf.der) }, { rawBytes: b64(intermediate.der) }],
        },
      }),
    );
    for (const trustedIdentities of [undefined, []]) {
      const result = verifyProvenance(viaChain, {
        trustedRootsPem: [root.pem],
        at: AT,
        expectedDigests: BOUND,
        ...(trustedIdentities === undefined ? {} : { trustedIdentities }),
      });
      expect(result).toMatchObject({
        chain: 'verified',
        signature: 'not_configured',
        slsaLevel: 1,
      });
      expect(result.reasons).toContain(
        'trusted roots are configured with no trusted identities, so a certificate signature was not checked',
      );
    }
    const keyPem = leaf.cert.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(
      verifyProvenance(viaChain, {
        trustedRootsPem: [root.pem],
        trustedKeysPem: [keyPem],
        at: AT,
        expectedDigests: BOUND,
      }),
    ).toMatchObject({ signature: 'verified', slsaLevel: 2 });
  });

  it('does not trust a certificate that chains elsewhere, has expired, or has no time to check', () => {
    const direct = parseProvenance(bundle(slsaV1(), directLeaf));
    const elsewhere = verifyProvenance(direct, {
      trustedRootsPem: [otherRoot.pem],
      trustedIdentities: DIRECT_IDENTITY,
      at: AT,
    });
    expect(elsewhere).toMatchObject({ chain: 'untrusted', signature: 'invalid', slsaLevel: 1 });
    expect(elsewhere.reasons).toContain('the certificate does not chain to a trusted root');

    const missingIntermediate = verifyProvenance(parseProvenance(bundle(slsaV1(), leaf)), {
      trustedRootsPem: [root.pem],
      at: AT,
    });
    expect(missingIntermediate.chain).toBe('untrusted');

    const expired = verifyProvenance(parseProvenance(bundle(slsaV1(), expiredLeaf)), {
      trustedRootsPem: [root.pem],
      at: AT,
    });
    expect(expired.chain).toBe('untrusted');
    expect(expired.reasons).toContain(
      'certificate CN=old@example.com is not valid at 2025-06-01T00:00:00.000Z',
    );

    const futureRoot = verifyProvenance(parseProvenance(bundle(slsaV1(), futureLeaf)), {
      trustedRootsPem: [notYetRoot.pem],
      at: AT,
    });
    expect(futureRoot.chain).toBe('untrusted');

    const noTime = verifyProvenance(direct, { trustedRootsPem: [root.pem] });
    expect(noTime.chain).toBe('untrusted');
    expect(noTime.reasons).toContain(
      'no verification time given, so certificate validity cannot be checked',
    );

    const corrupt: ParsedProvenance = { ...direct, certificatePem: 'not a certificate' };
    const unreadable = verifyProvenance(corrupt, { trustedRootsPem: [root.pem], at: AT });
    expect(unreadable.chain).toBe('untrusted');
    expect(unreadable.reasons).toContain('the bundle certificate cannot be read');

    const badIntermediate: ParsedProvenance = { ...direct, chainPems: ['also not'] };
    const skipped = verifyProvenance(badIntermediate, { trustedRootsPem: [root.pem], at: AT });
    expect(skipped.chain).toBe('verified');
    expect(skipped.reasons).toContain('chain certificate 1 is not a certificate');
  });

  it('says so when an allow-list is configured and the provenance names no builder', () => {
    const anonymous = parseProvenance(
      bytes({
        _type: 'https://in-toto.io/Statement/v1',
        subject: [],
        predicateType: 'https://slsa.dev/provenance/v1',
      }),
    );
    const result = verifyProvenance(anonymous, { allowedBuilders: [BUILDER] });
    expect(result).toMatchObject({ builderAllowed: false, signature: 'unsigned', slsaLevel: 1 });
    expect(result.reasons).toContain('the provenance names no builder');
  });

  it('still verifies against a trusted key when the certificate chain is untrusted', () => {
    const direct = parseProvenance(bundle(slsaV1(), directLeaf));
    const keyPem = directLeaf.cert.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(
      verifyProvenance(direct, {
        trustedKeysPem: [keyPem],
        trustedRootsPem: [otherRoot.pem],
        at: AT,
        expectedDigests: [{ alg: 'sha256', value: DIGEST }],
      }),
    ).toMatchObject({
      signature: 'verified',
      chain: 'untrusted',
      slsaLevel: 2,
    });
    expect(verifyProvenance(direct, { trustedKeysPem: [keyPem] }).chain).toBe('not_configured');
  });
});

describe('provenanceMetric', () => {
  const BOUND = [{ alg: 'sha256', value: DIGEST }];

  it('scores the SLSA level the evidence supports, and says the log was not checked', () => {
    const parsed = parseProvenance(bytes(envelope(slsaV1(), ecKeys.privateKey)));
    const level2 = provenanceMetric(
      verifyProvenance(parsed, { trustedKeysPem: [pem(ecKeys.publicKey)], expectedDigests: BOUND }),
    );
    expect(DimensionMetricSchema.parse(level2)).toEqual({
      dimension: 'supply-chain',
      metric: 'slsa-level',
      tool: { name: 'in-toto', version: null },
      score: (2 / 3) * 100,
      summary:
        'Provenance: SLSA L2, builder not checked, signature verified, transparency log not checked',
    });
    const level3 = provenanceMetric(
      verifyProvenance(parsed, {
        trustedKeysPem: [pem(ecKeys.publicKey)],
        allowedBuilders: [BUILDER],
        expectedDigests: BOUND,
      }),
    );
    expect(level3.summary).toBe(
      'Provenance: SLSA L3, builder ✓, signature verified, transparency log not checked',
    );
    expect(level3.score).toBe(100);
    const level0 = provenanceMetric(
      verifyProvenance(parseProvenance(bytes({ ...slsaV1(), predicateType: 'x' })), {
        allowedBuilders: [],
      }),
    );
    expect(level0.summary).toBe(
      'Provenance: SLSA L0, builder ✗, signature unsigned, transparency log not checked',
    );
    expect(level0.score).toBe(0);
    const notConfigured = provenanceMetric(verifyProvenance(parsed, {}));
    expect(notConfigured.summary).toContain('signature not configured');
  });
});
