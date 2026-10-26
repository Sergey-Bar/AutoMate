import { createPublicKey, verify, X509Certificate, type KeyObject } from 'node:crypto';
import type { DimensionMetric } from '@automate/shared-contracts';
import { certificateIdentity, identityTrusted } from './certificate-identity.js';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { type Json, record, list, text } from './json-fields.js';

/**
 * Build provenance — an in-toto Statement, usually carrying a SLSA Provenance predicate —
 * read raw, inside a DSSE envelope, or inside a Sigstore bundle (v0.1–v0.3), and verified
 * against trust the caller configures.
 *
 * ## What "verified" means here, and what it does not
 *
 * - **The signature** is checked with `node:crypto` over the DSSE pre-authentication encoding
 *   (`DSSEv1 <len> <type> <len> <payload>`), never over the payload alone — that is what
 *   binds the payload type into the signature. It is checked against each configured public
 *   key, and against the bundle's leaf certificate **only when that certificate chains to a
 *   configured root**. With no keys and no roots configured the answer is `not_configured`,
 *   never `verified`: a signature checked against a key the document itself supplied proves
 *   only that somebody had a key.
 * - **The chain** is walked with `X509Certificate.checkIssued` and `verify` from the leaf
 *   through the bundle's intermediates to a configured root, each certificate valid at the
 *   caller's `at`. There is no clock here, so without `at` validity cannot be checked and the
 *   chain is `untrusted`. A Fulcio certificate lives for ten minutes; the time that matters is
 *   when it signed, which only the transparency log attests. The bundle's own
 *   `integratedTime` is surfaced as `integratedTime` for a caller that chooses to trust it,
 *   and is never used implicitly.
 * - **The Rekor transparency log is not checked.** No inclusion proof, signed entry timestamp
 *   or checkpoint is verified, so `transparencyLog` is always `not_checked` and the summary
 *   says so. Without it, a certificate key that leaked after its ten minutes is not detected;
 *   that is the gap a reader must know about.
 *
 * ## The SLSA level the evidence supports
 *
 * Not the level the producer claims — the level this verification can stand behind:
 *
 * | Level | Requires                                                                |
 * | ----- | ----------------------------------------------------------------------- |
 * | 0     | not SLSA provenance, or it describes a different artifact               |
 * | 1     | SLSA provenance exists                                                  |
 * | 2     | and its subject is the expected artifact digest, and its signature     |
 * |       | verified against configured trust                                       |
 * | 3     | and its builder is on the configured allow-list                         |
 *
 * Without an expected digest (`subjectMatches: null`) the provenance is held at level 1
 * however well it is signed: a valid signature over a statement about some other build
 * proves nothing about this artifact.
 *
 * A certificate that chains to a configured root counts only when its SAN (and, when the
 * policy names one, its OIDC issuer extension) is one of `trustedIdentities`. A root says who
 * issued the certificate, and a public CA such as Fulcio issues to anyone with an account.
 *
 * Level 3 in the SLSA specification is a property of the build platform (isolation,
 * unforgeable provenance). An allow-list of builders known to provide it is how a consumer
 * can rely on that property, which is why the allow-list is the gate rather than anything
 * the provenance says about itself.
 */
export const PROVENANCE_ADAPTER_VERSION = '1';

export const IN_TOTO_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const SLSA_PREDICATES = new Set([
  'https://slsa.dev/provenance/v1',
  'https://slsa.dev/provenance/v0.2',
  'https://slsa.dev/provenance/v0.1',
]);

export interface ProvenanceSubject {
  name: string;
  digests: Record<string, string>;
}

export interface ProvenanceStatement {
  subjects: ProvenanceSubject[];
  predicateType: string;
  builderId: string | null;
  buildType: string | null;
  invocationId: string | null;
}

export interface DsseEnvelope {
  payloadType: string;
  payload: Uint8Array;
  signatures: { keyid: string | null; sig: Uint8Array }[];
}

export interface ParsedProvenance {
  statement: ProvenanceStatement;
  envelope: DsseEnvelope | null;
  certificatePem: string | null;
  /** The bundle's intermediates, leaf excluded. */
  chainPems: string[];
  /** The bundle's claimed log integration time — unverified, because the log is not checked. */
  integratedTime: string | null;
}

/**
 * A signer identity a root-chained certificate must carry: `subject` is matched exactly
 * against the leaf's SAN URIs and emails, and `issuer`, when given, against the Fulcio OIDC
 * issuer extension (1.3.6.1.4.1.57264.1.8, or the legacy 1.3.6.1.4.1.57264.1.1).
 */
export interface TrustedIdentity {
  subject: string;
  issuer?: string;
}

export interface ProvenancePolicy {
  expectedDigests?: readonly { alg: string; value: string }[];
  allowedBuilders?: readonly string[];
  trustedKeysPem?: readonly string[];
  trustedRootsPem?: readonly string[];
  /**
   * Who may sign under `trustedRootsPem`. A CA root says only that the CA issued the
   * certificate — for a public CA such as Fulcio, to anyone with an OIDC account — so a
   * certificate signature counts only when the leaf's identity is one of these. With roots
   * and no identities, certificate signatures are not checked at all (`not_configured`).
   */
  trustedIdentities?: readonly TrustedIdentity[];
  /** When certificates must be valid. Without it, no certificate chain can be trusted. */
  at?: Date;
}

export interface ProvenanceVerification {
  subjectMatches: boolean | null;
  builderAllowed: boolean | null;
  signature: 'verified' | 'invalid' | 'not_configured' | 'unsigned';
  chain: 'verified' | 'untrusted' | 'not_configured' | 'absent';
  transparencyLog: 'not_checked';
  slsaLevel: 0 | 1 | 2 | 3;
  reasons: string[];
}

function malformed(message: string): never {
  throw new HealthReportError('malformed', message);
}

/** DSSE allows standard or URL-safe base64; anything else is refused rather than half-decoded. */
const BASE64 = /^[A-Za-z0-9+/_-]*={0,2}$/u;

function base64(value: unknown, what: string): Uint8Array {
  if (typeof value !== 'string' || !BASE64.test(value)) malformed(`${what} is not base64`);
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function json(input: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(input));
  } catch {
    return malformed(`${what} is not valid JSON`);
  }
}

/** The DSSE v1 pre-authentication encoding: what is actually signed. Lengths are in bytes. */
export function dssePae(payloadType: string, payload: Uint8Array): Uint8Array {
  const type = Buffer.from(payloadType, 'utf8');
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(`DSSEv1 ${String(type.length)} `),
      type,
      Buffer.from(` ${String(payload.byteLength)} `),
      payload,
    ]),
  );
}

function subjectOf(raw: unknown): ProvenanceSubject | null {
  const subject = record(raw);
  if (subject === null) return null;
  const digests: Record<string, string> = {};
  for (const [alg, value] of Object.entries(record(subject['digest']) ?? {})) {
    if (typeof value === 'string') digests[alg] = value;
  }
  return { name: text(subject['name']) ?? '', digests };
}

/** SLSA v1 nests builder and build type under `runDetails`/`buildDefinition`; v0.x does not. */
function statementOf(value: unknown): ProvenanceStatement {
  const statement = record(value);
  const type = text(statement?.['_type']);
  if (statement === null || type?.startsWith('https://in-toto.io/Statement/') !== true) {
    throw new HealthReportError('unsupported', 'not an in-toto Statement');
  }
  const predicateType = text(statement['predicateType']);
  if (!Array.isArray(statement['subject']) || predicateType === null) {
    malformed('in-toto Statement has no subject array or predicateType');
  }
  const predicate = record(statement['predicate']);
  const runDetails = record(predicate?.['runDetails']);
  return {
    subjects: statement['subject']
      .map(subjectOf)
      .filter((subject): subject is ProvenanceSubject => subject !== null),
    predicateType,
    builderId:
      text(record(runDetails?.['builder'])?.['id']) ?? text(record(predicate?.['builder'])?.['id']),
    buildType:
      text(record(predicate?.['buildDefinition'])?.['buildType']) ?? text(predicate?.['buildType']),
    invocationId:
      text(record(runDetails?.['metadata'])?.['invocationId']) ??
      text(record(predicate?.['metadata'])?.['buildInvocationId']),
  };
}

function envelopeOf(raw: Json): DsseEnvelope {
  const payloadType = text(raw['payloadType']);
  if (payloadType !== IN_TOTO_PAYLOAD_TYPE) {
    throw new HealthReportError(
      'unsupported',
      `DSSE payload type ${String(payloadType)} is not in-toto`,
    );
  }
  if (!Array.isArray(raw['signatures'])) malformed('DSSE envelope has no signatures array');
  return {
    payloadType,
    payload: base64(raw['payload'], 'DSSE payload'),
    signatures: raw['signatures'].flatMap((entry) => {
      const signature = record(entry);
      if (signature === null) return [];
      return [{ keyid: text(signature['keyid']), sig: base64(signature['sig'], 'DSSE signature') }];
    }),
  };
}

function toPem(der: Uint8Array): string {
  const body = Buffer.from(der).toString('base64');
  const lines: string[] = [];
  for (let offset = 0; offset < body.length; offset += 64)
    lines.push(body.slice(offset, offset + 64));
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** v0.3 carries the leaf alone as `certificate`; v0.1/v0.2 carry `x509CertificateChain`, leaf first. */
function bundleCertificates(material: Json | null): string[] {
  const single = record(material?.['certificate']);
  const chain =
    single === null ? list(record(material?.['x509CertificateChain'])?.['certificates']) : [single];
  return chain.flatMap((entry) => {
    const raw = record(entry)?.['rawBytes'];
    return raw === undefined ? [] : [toPem(base64(raw, 'bundle certificate'))];
  });
}

function integratedTimeOf(material: Json | null): string | null {
  const raw = record(list(material?.['tlogEntries'])[0])?.['integratedTime'];
  const seconds = typeof raw === 'string' ? Number(raw) : raw;
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function fromEnvelope(raw: Json): Pick<ParsedProvenance, 'statement' | 'envelope'> {
  const envelope = envelopeOf(raw);
  return { statement: statementOf(json(envelope.payload, 'DSSE payload')), envelope };
}

/**
 * A raw in-toto Statement, a DSSE envelope, or a Sigstore bundle with a `dsseEnvelope`.
 *
 * @throws HealthReportError `too_large` over the byte cap; `unsupported` for JSON that is
 *   none of the three, a non-in-toto payload, or a message-signature bundle; `malformed` for
 *   broken JSON, base64 or a statement missing its subject or predicate type.
 */
export function parseProvenance(input: Uint8Array): ParsedProvenance {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `provenance is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  const document = record(json(input, 'provenance'));
  if (document === null) return malformed('provenance is not a JSON object');

  const dsse = record(document['dsseEnvelope']);
  if (dsse !== null) {
    const material = record(document['verificationMaterial']);
    const [certificatePem = null, ...chainPems] = bundleCertificates(material);
    return {
      ...fromEnvelope(dsse),
      certificatePem,
      chainPems,
      integratedTime: integratedTimeOf(material),
    };
  }
  const empty = { certificatePem: null, chainPems: [], integratedTime: null };
  if ('payloadType' in document) return { ...fromEnvelope(document), ...empty };
  if ('_type' in document) return { statement: statementOf(document), envelope: null, ...empty };
  throw new HealthReportError(
    'unsupported',
    'not an in-toto Statement, a DSSE envelope, or a Sigstore bundle with a DSSE envelope',
  );
}

// ─── Verification ───────────────────────────────────────────────────────────

/** The digest each key type signs with; Ed25519 and Ed448 take none. */
function digestFor(key: KeyObject): string | null {
  if (key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448') return null;
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (curve === 'secp384r1') return 'sha384';
  if (curve === 'secp521r1') return 'sha512';
  return 'sha256';
}

function signatureVerifies(key: KeyObject, data: Uint8Array, sig: Uint8Array): boolean {
  try {
    return verify(digestFor(key), data, key, sig);
  } catch {
    // A key that cannot verify at all (an X25519 key, say) verifies nothing.
    return false;
  }
}

function validAt(cert: X509Certificate, at: Date): boolean {
  return cert.validFromDate <= at && at <= cert.validToDate;
}

/** Leaf → intermediates → a configured root, each link signed by the next, each valid at `at`. */
function chainVerifies(
  leaf: X509Certificate,
  intermediates: readonly X509Certificate[],
  roots: readonly X509Certificate[],
  at: Date,
  reasons: string[],
): boolean {
  const visited = new Set<X509Certificate>();
  let current = leaf;
  for (;;) {
    if (!validAt(current, at)) {
      reasons.push(`certificate ${current.subject} is not valid at ${at.toISOString()}`);
      return false;
    }
    const issuedBy = (candidate: X509Certificate): boolean =>
      current.checkIssued(candidate) && current.verify(candidate.publicKey);
    const anchor =
      roots.find((root) => root.fingerprint256 === current.fingerprint256) ?? roots.find(issuedBy);
    if (anchor !== undefined) {
      if (validAt(anchor, at)) return true;
      reasons.push(`trusted root ${anchor.subject} is not valid at ${at.toISOString()}`);
      return false;
    }
    visited.add(current);
    const next = intermediates.find(
      (candidate) => !visited.has(candidate) && candidate.ca && issuedBy(candidate),
    );
    if (next === undefined) {
      reasons.push('the certificate does not chain to a trusted root');
      return false;
    }
    current = next;
  }
}

function certificates(pems: readonly string[], what: string, reasons: string[]): X509Certificate[] {
  return pems.flatMap((pem, index) => {
    try {
      return [new X509Certificate(pem)];
    } catch {
      reasons.push(`${what} ${String(index + 1)} is not a certificate`);
      return [];
    }
  });
}

function chainStatus(
  parsed: ParsedProvenance,
  policy: ProvenancePolicy,
  reasons: string[],
): { chain: ProvenanceVerification['chain']; leaf: X509Certificate | null } {
  if (parsed.certificatePem === null) return { chain: 'absent', leaf: null };
  const rootPems = policy.trustedRootsPem ?? [];
  if (rootPems.length === 0) return { chain: 'not_configured', leaf: null };
  const roots = certificates(rootPems, 'trusted root', reasons);
  let leaf: X509Certificate;
  try {
    leaf = new X509Certificate(parsed.certificatePem);
  } catch {
    reasons.push('the bundle certificate cannot be read');
    return { chain: 'untrusted', leaf: null };
  }
  if (policy.at === undefined) {
    reasons.push('no verification time given, so certificate validity cannot be checked');
    return { chain: 'untrusted', leaf: null };
  }
  const intermediates = certificates(parsed.chainPems, 'chain certificate', reasons);
  return chainVerifies(leaf, intermediates, roots, policy.at, reasons)
    ? { chain: 'verified', leaf }
    : { chain: 'untrusted', leaf: null };
}

function trustedKeys(pems: readonly string[], reasons: string[]): KeyObject[] {
  return pems.flatMap((pem, index) => {
    try {
      return [createPublicKey(pem)];
    } catch {
      reasons.push(`trusted key ${String(index + 1)} is not a public key`);
      return [];
    }
  });
}

/**
 * The leaf's key, when its identity is one the policy trusts. A root without an identity
 * policy proves only who issued the certificate, so the leaf is never used then.
 */
function identityKey(
  trustedLeaf: X509Certificate | null,
  identities: readonly TrustedIdentity[],
  reasons: string[],
): KeyObject | null {
  if (trustedLeaf === null || identities.length === 0) return null;
  const identity = certificateIdentity(trustedLeaf);
  if (identityTrusted(identity, identities)) return trustedLeaf.publicKey;
  const who = identity.subjects.length === 0 ? '(no SAN)' : identity.subjects.join(', ');
  reasons.push(`certificate identity ${who} is not trusted`);
  return null;
}

function signatureStatus(
  parsed: ParsedProvenance,
  policy: ProvenancePolicy,
  trustedLeaf: X509Certificate | null,
  reasons: string[],
): ProvenanceVerification['signature'] {
  const { envelope } = parsed;
  if (envelope === null || envelope.signatures.length === 0) {
    reasons.push('the provenance is not signed');
    return 'unsigned';
  }
  const keyPems = policy.trustedKeysPem ?? [];
  const hasRoots = (policy.trustedRootsPem ?? []).length > 0;
  if (keyPems.length === 0 && !hasRoots) {
    reasons.push('no trusted keys or roots configured, so the signature was not checked');
    return 'not_configured';
  }
  const identities = policy.trustedIdentities ?? [];
  const certificatesChecked = hasRoots && identities.length > 0;
  if (hasRoots && !certificatesChecked) {
    reasons.push(
      'trusted roots are configured with no trusted identities, so a certificate signature was not checked',
    );
  }
  const keys = trustedKeys(keyPems, reasons);
  const leafKey = identityKey(trustedLeaf, identities, reasons);
  if (leafKey !== null) keys.push(leafKey);
  const signed = dssePae(envelope.payloadType, envelope.payload);
  const verified = envelope.signatures.some(({ sig }) =>
    keys.some((key) => signatureVerifies(key, signed, sig)),
  );
  if (verified) return 'verified';
  if (keys.length === 0 && !certificatesChecked) return 'not_configured';
  reasons.push('no signature verifies against the configured trust');
  return 'invalid';
}

function subjectStatus(
  statement: ProvenanceStatement,
  expected: ProvenancePolicy['expectedDigests'],
  reasons: string[],
): boolean | null {
  if (expected === undefined) return null;
  let matches = true;
  for (const { alg, value } of expected) {
    const found = statement.subjects.some((subject) =>
      Object.entries(subject.digests).some(
        ([subjectAlg, digest]) =>
          subjectAlg.toLowerCase() === alg.toLowerCase() &&
          digest.toLowerCase() === value.toLowerCase(),
      ),
    );
    if (!found) {
      reasons.push(`no subject carries the expected digest ${alg}:${value}`);
      matches = false;
    }
  }
  return matches;
}

function builderStatus(
  builderId: string | null,
  allowed: ProvenancePolicy['allowedBuilders'],
  reasons: string[],
): boolean | null {
  if (allowed === undefined) {
    reasons.push('no builder allow-list configured, so SLSA level 3 cannot be claimed');
    return null;
  }
  if (builderId === null) {
    reasons.push('the provenance names no builder');
    return false;
  }
  if (allowed.includes(builderId)) return true;
  reasons.push(`builder ${builderId} is not on the allow-list`);
  return false;
}

/**
 * What the provenance proves under the caller's trust policy. Every shortfall is a sentence
 * in `reasons`, so a level below 3 always says why.
 */
export function verifyProvenance(
  parsed: ParsedProvenance,
  policy: ProvenancePolicy,
): ProvenanceVerification {
  const reasons: string[] = [];
  const { statement } = parsed;
  const subjectMatches = subjectStatus(statement, policy.expectedDigests, reasons);
  const isSlsa = SLSA_PREDICATES.has(statement.predicateType);
  if (!isSlsa) reasons.push(`predicate ${statement.predicateType} is not SLSA provenance`);
  const { chain, leaf } = chainStatus(parsed, policy, reasons);
  const signature = signatureStatus(parsed, policy, leaf, reasons);
  const builderAllowed = builderStatus(statement.builderId, policy.allowedBuilders, reasons);

  let slsaLevel: ProvenanceVerification['slsaLevel'] = 0;
  if (isSlsa && subjectMatches !== false) {
    slsaLevel = 1;
    if (signature === 'verified' && subjectMatches === null) {
      reasons.push(
        'no expected artifact digest was given, so the provenance is not bound to the artifact and is held at SLSA level 1',
      );
    }
    // A signed statement about some other build proves nothing about this artifact: L2 and
    // L3 need the subject to be the artifact, not merely not shown to be a different one.
    if (signature === 'verified' && subjectMatches === true) {
      slsaLevel = builderAllowed === true ? 3 : 2;
    }
  }
  reasons.push('the transparency log (Rekor) is not checked');
  return {
    subjectMatches,
    builderAllowed,
    signature,
    chain,
    transparencyLog: 'not_checked',
    slsaLevel,
    reasons,
  };
}

function builderWord(allowed: boolean | null): string {
  if (allowed === null) return 'not checked';
  return allowed ? '✓' : '✗';
}

/** The verification as a Supply-chain metric: the supported SLSA level over 3. */
export function provenanceMetric(result: ProvenanceVerification): DimensionMetric {
  return {
    dimension: 'supply-chain',
    metric: 'slsa-level',
    tool: { name: 'in-toto', version: null },
    score: (result.slsaLevel / 3) * 100,
    summary: `Provenance: SLSA L${String(result.slsaLevel)}, builder ${builderWord(
      result.builderAllowed,
    )}, signature ${result.signature.replace('_', ' ')}, transparency log not checked`,
  };
}
