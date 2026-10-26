import type { X509Certificate } from 'node:crypto';

/**
 * Who a signing certificate was issued to: its SAN URIs and emails, and the OIDC issuer
 * Fulcio records in an extension. A CA root proves only that the CA issued the certificate;
 * for a public CA that is anyone with an account, so the identity is what a trust policy
 * must name.
 *
 * The SAN is read from `X509Certificate.subjectAltName`. The issuer extension is not exposed
 * by `node:crypto`, so it is read from the DER with the small, bounded reader below: lengths
 * of at most four bytes, every element inside its parent, and a cap on how many elements one
 * sequence may hold. A certificate it cannot read has no issuer, never a guessed one.
 */
export interface CertificateIdentity {
  /** SAN URIs and emails, in certificate order. */
  subjects: string[];
  /** The OIDC issuer extension's value, `null` when absent or unreadable. */
  issuer: string | null;
}

/** 1.3.6.1.4.1.57264.1.8 — the issuer as a DER UTF8String (current Fulcio). */
const ISSUER_V2 = '1.3.6.1.4.1.57264.1.8';
/** 1.3.6.1.4.1.57264.1.1 — the issuer as raw bytes (legacy Fulcio, deprecated). */
const ISSUER_LEGACY = '1.3.6.1.4.1.57264.1.1';

const MAX_SAN_TEXT = 8192;
const MAX_CHILDREN = 256;

interface Tlv {
  tag: number;
  start: number;
  end: number;
}

/** One DER element at `offset`, or `null` when it does not fit inside `limit`. */
function readTlv(der: Uint8Array, offset: number, limit: number): Tlv | null {
  if (offset + 2 > limit) return null;
  const tag = der[offset] as number;
  let length = der[offset + 1] as number;
  let start = offset + 2;
  if (length >= 0x80) {
    const octets = length & 0x7f;
    if (octets === 0 || octets > 4 || start + octets > limit) return null;
    length = 0;
    for (let index = 0; index < octets; index += 1) {
      length = length * 256 + (der[start + index] as number);
    }
    start += octets;
  }
  const end = start + length;
  return end > limit ? null : { tag, start, end };
}

function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let offset = parent.start;
  while (offset < parent.end && out.length < MAX_CHILDREN) {
    const child = readTlv(der, offset, parent.end);
    if (child === null) break;
    out.push(child);
    offset = child.end;
  }
  return out;
}

/** The dotted form of an OBJECT IDENTIFIER's content octets. */
function oidText(bytes: Uint8Array): string {
  const arcs: number[] = [];
  let value = 0;
  for (const byte of bytes) {
    value = value * 128 + (byte & 0x7f);
    if (byte < 0x80) {
      arcs.push(value);
      value = 0;
    }
  }
  const [first = 0, ...rest] = arcs;
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...head, ...rest].join('.');
}

/** Every extension as `[oid, extnValue content]`: Certificate → tbs → [3] → Extensions. */
function extensions(der: Uint8Array): Array<[string, Uint8Array]> {
  const certificate = readTlv(der, 0, der.length);
  const tbs = certificate === null ? undefined : children(der, certificate)[0];
  const wrapper = tbs === undefined ? undefined : children(der, tbs).find((t) => t.tag === 0xa3);
  const list = wrapper === undefined ? undefined : children(der, wrapper)[0];
  if (list === undefined) return [];
  return children(der, list).flatMap((extension) => {
    const parts = children(der, extension);
    const id = parts[0];
    const value = parts[parts.length - 1];
    if (id?.tag !== 0x06 || value?.tag !== 0x04) return [];
    return [[oidText(der.subarray(id.start, id.end)), der.subarray(value.start, value.end)]];
  });
}

const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function issuerOf(der: Uint8Array): string | null {
  const found = new Map(extensions(der));
  const current = found.get(ISSUER_V2);
  if (current !== undefined) {
    const inner = readTlv(current, 0, current.length);
    if (inner?.tag === 0x0c) return utf8(current.subarray(inner.start, inner.end));
  }
  const legacy = found.get(ISSUER_LEGACY);
  return legacy === undefined ? null : utf8(legacy);
}

/**
 * `URI:…` and `email:…` entries of Node's SAN text. A value Node had to escape is a JSON
 * string, which is read as one; anything unreadable ends the walk rather than being guessed.
 */
const SAN_ENTRY = /(?:^|, )([A-Za-z ]{1,20}):("(?:[^"\\]|\\.)*"|[^,]*)/uy;

function sanSubjects(text: string | undefined): string[] {
  if (text === undefined || text.length > MAX_SAN_TEXT) return [];
  const subjects: string[] = [];
  SAN_ENTRY.lastIndex = 0;
  for (let match = SAN_ENTRY.exec(text); match !== null; match = SAN_ENTRY.exec(text)) {
    const [, kind = '', raw = ''] = match;
    let value = raw;
    if (raw.startsWith('"')) {
      try {
        value = String(JSON.parse(raw));
      } catch {
        break;
      }
    }
    if (kind === 'URI' || kind === 'email') subjects.push(value);
  }
  return subjects;
}

export function certificateIdentity(cert: X509Certificate): CertificateIdentity {
  return { subjects: sanSubjects(cert.subjectAltName), issuer: issuerOf(cert.raw) };
}

/** Whether the identity is one of `trusted`: an exact subject, and the issuer when named. */
export function identityTrusted(
  identity: CertificateIdentity,
  trusted: readonly { subject: string; issuer?: string | undefined }[],
): boolean {
  return trusted.some(
    (entry) =>
      identity.subjects.includes(entry.subject) &&
      (entry.issuer === undefined || entry.issuer === identity.issuer),
  );
}
