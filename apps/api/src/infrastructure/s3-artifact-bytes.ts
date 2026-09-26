import { createHash, createHmac } from 'node:crypto';

/**
 * Minimal S3-compatible artifact bytes adapter.
 *
 * Artifact bytes are evidence: they must outlive an API process and be readable
 * by every replica, so production stores them in a durable object store. Only
 * the two operations the platform needs are implemented — a single authenticated
 * PUT and GET — using the Node standard library (node:crypto plus fetch) so no
 * S3 SDK becomes a production dependency.
 */

const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';
const SIGV4_TERMINATOR = 'aws4_request';
const S3_SERVICE = 's3';
const BINARY_CONTENT_TYPE = 'application/octet-stream';
const MAX_ERROR_BODY_BYTES = 1024;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const UNRESERVED_EXTRA = /[!'()*]/g;

export const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_OBJECT_STORE_TIMEOUT_MS = 15_000;
export const MAX_STORAGE_KEY_LENGTH = 1024;

export interface ObjectStoreSettings {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  allowInsecureHttp: boolean;
  maxBytes: number;
  timeoutMs: number;
}

export type ObjectStoreSettingsInput = Partial<ObjectStoreSettings>;

export interface SigV4Request {
  method: string;
  /** RFC 3986 encoded path, already prefixed with the bucket when path-style. */
  canonicalUri: string;
  headers: Record<string, string>;
  payloadHash: string;
  date: Date;
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface S3ArtifactBytesStoreOptions {
  now?: () => Date;
  fetch?: typeof fetch;
}

function sha256Hex(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Uint8Array {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key: Uint8Array, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Uint8Array {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, SIGV4_TERMINATOR);
}

function amzTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');
}

/** RFC 3986 percent-encoding: `!'()*` are escaped even though encodeURIComponent leaves them. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    UNRESERVED_EXTRA,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectPath(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}

function requireText(value: string | undefined, variable: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${variable} is required`);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Produces the SigV4 `Authorization` header value for one request. Exported so
 * the signature can be checked against the published AWS test vectors instead of
 * only against this adapter's own round trip.
 */
export function signSigV4(credentials: SigV4Credentials, request: SigV4Request): string {
  const amzDate = amzTimestamp(request.date);
  const dateStamp = amzDate.slice(0, 8);
  const normalized = new Map(
    Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const names = [...normalized.keys()].sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${(normalized.get(name) ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    request.method,
    request.canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${credentials.region}/${credentials.service}/${SIGV4_TERMINATOR}`;
  const stringToSign = [SIGV4_ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmacHex(
    deriveSigningKey(
      credentials.secretAccessKey,
      dateStamp,
      credentials.region,
      credentials.service,
    ),
    stringToSign,
  );
  return `${SIGV4_ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * Storage keys travel from the runner upload path straight into an object name,
 * so they are validated here exactly as strictly as the local store validates
 * them: relative, no traversal, no control characters, bounded length.
 */
export function assertArtifactStorageKey(storageKey: string): string {
  if (typeof storageKey !== 'string' || storageKey.length === 0) {
    throw new Error('Artifact storage key is required');
  }
  // S3 bounds an object key at 1024 bytes, not characters.
  if (Buffer.byteLength(storageKey, 'utf8') > MAX_STORAGE_KEY_LENGTH) {
    throw new Error(`Artifact storage key must be at most ${MAX_STORAGE_KEY_LENGTH} bytes`);
  }
  if (storageKey.startsWith('/') || storageKey.includes('\\')) {
    throw new Error('Artifact storage key must be relative');
  }
  if (storageKey.includes('..') || storageKey.includes('//') || storageKey.endsWith('/')) {
    throw new Error('Artifact storage key must not contain traversal or empty segments');
  }
  if (hasControlCharacter(storageKey)) {
    throw new Error('Artifact storage key must not contain control characters');
  }
  return storageKey;
}

export function normalizeObjectStoreSettings(input: ObjectStoreSettingsInput): ObjectStoreSettings {
  const endpoint = requireText(input.endpoint, 'OBJECT_STORE_ENDPOINT');
  const bucket = requireText(input.bucket, 'OBJECT_STORE_BUCKET');
  const region = requireText(input.region, 'OBJECT_STORE_REGION');
  const accessKeyId = requireText(input.accessKeyId, 'OBJECT_STORE_ACCESS_KEY_ID');
  const secretAccessKey = requireText(input.secretAccessKey, 'OBJECT_STORE_SECRET_ACCESS_KEY');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('OBJECT_STORE_ENDPOINT must be an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OBJECT_STORE_ENDPOINT must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('OBJECT_STORE_ENDPOINT must not embed credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('OBJECT_STORE_ENDPOINT must not include a query string or fragment');
  }
  if (!BUCKET_NAME.test(bucket)) {
    throw new Error('OBJECT_STORE_BUCKET must be a lowercase S3 bucket name of 3 to 63 characters');
  }
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error('OBJECT_STORE_MAX_BYTES must be a positive integer');
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_OBJECT_STORE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('OBJECT_STORE_TIMEOUT_MS must be a positive integer');
  }
  return {
    endpoint: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: input.forcePathStyle ?? false,
    allowInsecureHttp: input.allowInsecureHttp ?? false,
    maxBytes,
    timeoutMs,
  };
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // `Buffer.from(value.buffer, ...)` would create a *view* over the stream's
    // recyclable chunk, so the bytes could be overwritten before the response
    // is consumed — silently corrupted evidence. Copy instead.
    chunks.push(Buffer.from(value));
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      break;
    }
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export class S3ArtifactBytesStore {
  private readonly settings: ObjectStoreSettings;
  private readonly base: URL;
  private readonly now: () => Date;
  private readonly request: typeof fetch;

  constructor(settings: ObjectStoreSettingsInput, options: S3ArtifactBytesStoreOptions = {}) {
    this.settings = normalizeObjectStoreSettings(settings);
    this.base = new URL(this.settings.endpoint);
    this.now = options.now ?? (() => new Date());
    this.request = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async put(storageKey: string, bytes: Uint8Array): Promise<void> {
    const key = assertArtifactStorageKey(storageKey);
    if (bytes.byteLength > this.settings.maxBytes) {
      throw new Error(
        `Artifact is ${bytes.byteLength} bytes, above the ${this.settings.maxBytes}-byte object store limit`,
      );
    }
    const response = await this.send('PUT', key, bytes, BINARY_CONTENT_TYPE);
    if (!response.ok) throw await this.failure('put', key, response);
    await discard(response);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    const key = assertArtifactStorageKey(storageKey);
    const response = await this.send('GET', key, new Uint8Array());
    // Only a missing object is a miss; every other failure is a real storage
    // error the caller must see instead of being reported as absent evidence.
    if (response.status === 404) {
      await discard(response);
      return null;
    }
    if (!response.ok) throw await this.failure('get', key, response);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.settings.maxBytes) {
      throw new Error(
        `Artifact is ${declared} bytes, above the ${this.settings.maxBytes}-byte object store limit`,
      );
    }
    const bytes = await readBounded(response, this.settings.maxBytes);
    if (bytes.byteLength > this.settings.maxBytes) {
      throw new Error(`Artifact is above the ${this.settings.maxBytes}-byte object store limit`);
    }
    return bytes;
  }

  private resolveTarget(key: string): { url: string; host: string; canonicalUri: string } {
    const prefix = this.base.pathname.replace(/^\/+|\/+$/g, '');
    const objectPath = encodeObjectPath(key);
    if (this.settings.forcePathStyle) {
      const canonicalUri = `/${[prefix, encodeSegment(this.settings.bucket), objectPath]
        .filter((part) => part !== '')
        .join('/')}`;
      return { canonicalUri, host: this.base.host, url: `${this.base.origin}${canonicalUri}` };
    }
    const canonicalUri = `/${[prefix, objectPath].filter((part) => part !== '').join('/')}`;
    const host = `${this.settings.bucket}.${this.base.host}`;
    return { canonicalUri, host, url: `${this.base.protocol}//${host}${canonicalUri}` };
  }

  private async send(
    method: 'GET' | 'PUT',
    key: string,
    payload: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const { url, host, canonicalUri } = this.resolveTarget(key);
    const date = this.now();
    const payloadHash = sha256Hex(payload);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzTimestamp(date),
    };
    headers['authorization'] = signSigV4(
      {
        accessKeyId: this.settings.accessKeyId,
        secretAccessKey: this.settings.secretAccessKey,
        region: this.settings.region,
        service: S3_SERVICE,
      },
      { method, canonicalUri, headers, payloadHash, date },
    );
    if (contentType !== undefined) headers['content-type'] = contentType;
    return this.request(url, {
      method,
      headers,
      body: payload.byteLength === 0 ? undefined : payload,
      signal: AbortSignal.timeout(this.settings.timeoutMs),
    });
  }

  private async failure(operation: string, key: string, response: Response): Promise<Error> {
    const detail = Buffer.from(await readBounded(response, MAX_ERROR_BODY_BYTES))
      .toString('utf8')
      .trim()
      .slice(0, MAX_ERROR_BODY_BYTES);
    return new Error(
      `Object store ${operation} for ${key} failed with ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }
}
