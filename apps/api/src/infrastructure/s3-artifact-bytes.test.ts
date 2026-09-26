import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  MAX_STORAGE_KEY_LENGTH,
  S3ArtifactBytesStore,
  assertArtifactStorageKey,
  normalizeObjectStoreSettings,
  signSigV4,
  type ObjectStoreSettings,
} from './s3-artifact-bytes.js';

const SETTINGS: ObjectStoreSettings = {
  endpoint: 'https://objects.example.com',
  bucket: 'automate-artifacts',
  region: 'eu-central-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  forcePathStyle: false,
  allowInsecureHttp: false,
  maxBytes: 1024,
  timeoutMs: 5000,
};

const FIXED_DATE = new Date('2026-09-25T16:11:57.123Z');
const FIXED_AMZ_DATE = '20260925T161157Z';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hexSha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Independent SigV4 recomputation used by the fake S3 server as an oracle. */
function verifySignature(request: IncomingMessage, payloadHash: string): boolean {
  const authorization = String(request.headers['authorization']);
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(authorization)?.[1];
  const presented = /Signature=([0-9a-f]+)/.exec(authorization)?.[1];
  const amzDate = String(request.headers['x-amz-date']);
  if (!signedHeaders || !presented || amzDate === 'undefined') return false;
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((name) => `${name}:${String(request.headers[name]).trim()}\n`)
    .join('');
  const canonicalRequest = [
    request.method,
    request.url,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = /Credential=[^/]+\/(\S+?),/.exec(authorization)?.[1] ?? '';
  const [dateStamp, region, service] = scope.split('/');
  const hmac = (key: Buffer | string, data: string) =>
    createHmac('sha256', key).update(data, 'utf8').digest();
  const key = hmac(
    hmac(hmac(hmac(`AWS4${SETTINGS.secretAccessKey}`, dateStamp), region), service),
    'aws4_request',
  );
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hexSha256(canonicalRequest)].join('\n');
  return createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex') === presented;
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** Minimal in-process S3-compatible object store used for the round trip. */
function createFakeS3(behavior: 'store' | 'silent' = 'store'): {
  server: Server;
  objects: Map<string, Buffer>;
} {
  const objects = new Map<string, Buffer>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (behavior === 'silent') return;
      const body = await readRequestBody(request);
      const payloadHash = String(request.headers['x-amz-content-sha256']);
      if (!verifySignature(request, payloadHash) || payloadHash !== hexSha256(body)) {
        response.writeHead(403, { 'content-type': 'text/plain' });
        response.end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
        return;
      }
      const key = request.url ?? '/';
      if (request.method === 'PUT') {
        objects.set(key, body);
        response.writeHead(200);
        response.end();
        return;
      }
      const stored = objects.get(key);
      if (!stored) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      response.writeHead(200, { 'content-length': String(stored.byteLength) });
      response.end(stored);
    })();
  });
  return {
    server,
    objects,
  };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

const openServers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(async (server) => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }),
  );
});

describe('signSigV4', () => {
  it('matches the published AWS S3 GET Object example', () => {
    // AWS "Signature Calculations for the Authorization Header: GET Object".
    const authorization = signSigV4(
      {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 's3',
      },
      {
        method: 'GET',
        canonicalUri: '/test.txt',
        headers: {
          host: 'examplebucket.s3.amazonaws.com',
          range: 'bytes=0-9',
          'x-amz-content-sha256': hexSha256(''),
          'x-amz-date': '20130524T000000Z',
        },
        payloadHash: hexSha256(''),
        date: new Date('2013-05-24T00:00:00.000Z'),
      },
    );
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches the aws-sig-v4-test-suite get-vanilla vector', () => {
    const authorization = signSigV4(
      {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 'service',
      },
      {
        method: 'GET',
        canonicalUri: '/',
        headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
        payloadHash: hexSha256(''),
        date: new Date('2015-08-30T12:36:00.000Z'),
      },
    );
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('canonicalizes header case and whitespace the way AWS requires', () => {
    const credentials = {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'service',
    };
    const lowercase = signSigV4(credentials, {
      method: 'GET',
      canonicalUri: '/',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: hexSha256(''),
      date: new Date('2015-08-30T12:36:00.000Z'),
    });
    const noisy = signSigV4(credentials, {
      method: 'GET',
      canonicalUri: '/',
      headers: { Host: '  example.amazonaws.com  ', 'X-Amz-Date': '20150830T123600Z' },
      payloadHash: hexSha256(''),
      date: new Date('2015-08-30T12:36:00.000Z'),
    });
    expect(noisy).toBe(lowercase);
  });
});

describe('normalizeObjectStoreSettings', () => {
  it('applies the byte and timeout defaults and normalizes the endpoint', () => {
    const settings = normalizeObjectStoreSettings({
      ...SETTINGS,
      endpoint: 'https://objects.example.com/',
      maxBytes: undefined,
      timeoutMs: undefined,
    });
    expect(settings.endpoint).toBe('https://objects.example.com');
    expect(settings.maxBytes).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
    expect(settings.timeoutMs).toBe(15_000);
  });

  it('rejects an incomplete or unusable configuration', () => {
    expect(() => normalizeObjectStoreSettings({ ...SETTINGS, endpoint: undefined })).toThrow(
      'OBJECT_STORE_ENDPOINT is required',
    );
    expect(() => normalizeObjectStoreSettings({ ...SETTINGS, secretAccessKey: '  ' })).toThrow(
      'OBJECT_STORE_SECRET_ACCESS_KEY is required',
    );
    expect(() =>
      normalizeObjectStoreSettings({ ...SETTINGS, endpoint: 'objects.example.com' }),
    ).toThrow('OBJECT_STORE_ENDPOINT must be an absolute URL');
    expect(() =>
      normalizeObjectStoreSettings({ ...SETTINGS, endpoint: 'ftp://objects.example.com' }),
    ).toThrow('OBJECT_STORE_ENDPOINT must use http or https');
    expect(() =>
      normalizeObjectStoreSettings({
        ...SETTINGS,
        endpoint: 'https://user:pass@objects.example.com',
      }),
    ).toThrow('OBJECT_STORE_ENDPOINT must not embed credentials');
    expect(() =>
      normalizeObjectStoreSettings({ ...SETTINGS, endpoint: 'https://objects.example.com/?x=1' }),
    ).toThrow('OBJECT_STORE_ENDPOINT must not include a query string or fragment');
    expect(() =>
      normalizeObjectStoreSettings({ ...SETTINGS, bucket: 'Automate_Artifacts' }),
    ).toThrow('OBJECT_STORE_BUCKET must be a lowercase S3 bucket name');
    expect(() => normalizeObjectStoreSettings({ ...SETTINGS, bucket: 'ab' })).toThrow(
      'OBJECT_STORE_BUCKET must be a lowercase S3 bucket name',
    );
    expect(() => normalizeObjectStoreSettings({ ...SETTINGS, maxBytes: 0 })).toThrow(
      'OBJECT_STORE_MAX_BYTES must be a positive integer',
    );
    expect(() => normalizeObjectStoreSettings({ ...SETTINGS, timeoutMs: 1.5 })).toThrow(
      'OBJECT_STORE_TIMEOUT_MS must be a positive integer',
    );
  });
});

describe('assertArtifactStorageKey', () => {
  it('accepts a run-scoped key and rejects traversal, absolute, and unbounded keys', () => {
    expect(assertArtifactStorageKey('runs/run-1/9f-artifact_report.json')).toBe(
      'runs/run-1/9f-artifact_report.json',
    );
    for (const key of [
      '',
      `/runs/run-1/file`,
      'runs\\run-1\\file',
      '../escape',
      'runs/../../escape',
      'runs//file',
      'runs/run-1/',
      'runs/run-1/\u0000file',
      'a'.repeat(MAX_STORAGE_KEY_LENGTH + 1),
      'ю'.repeat(MAX_STORAGE_KEY_LENGTH),
    ]) {
      expect(() => assertArtifactStorageKey(key)).toThrow();
    }
  });
});

describe('S3ArtifactBytesStore request construction', () => {
  function stubbedStore(overrides: Partial<ObjectStoreSettings> = {}): {
    store: S3ArtifactBytesStore;
    calls: { url: string; init: RequestInit }[];
  } {
    const calls: { url: string; init: RequestInit }[] = [];
    const store = new S3ArtifactBytesStore(
      { ...SETTINGS, ...overrides },
      {
        now: () => FIXED_DATE,
        fetch: ((url: string, init: RequestInit) => {
          calls.push({ url, init });
          return Promise.resolve(new Response('', { status: 200 }));
        }) as unknown as typeof fetch,
      },
    );
    return { store, calls };
  }

  it('signs a path-style PUT with a single-encoded key and a bounded timeout', async () => {
    const { store, calls } = stubbedStore({ forcePathStyle: true });
    const payload = bytes('evidence');
    await store.put('runs/run 1/na+me (1).txt', payload);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe(
      'https://objects.example.com/automate-artifacts/runs/run%201/na%2Bme%20%281%29.txt',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE);
    expect(headers['x-amz-content-sha256']).toBe(hexSha256(payload));
    expect(headers['authorization']).toContain(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260925/eu-central-1/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=',
    );
    expect(headers['host']).toBe('objects.example.com');
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(init.method).toBe('PUT');
    expect(init.body).toEqual(payload);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('moves the bucket into the host for virtual-hosted-style requests', async () => {
    const { store, calls } = stubbedStore();
    await store.put('runs/run-1/report.json', bytes('{}'));
    expect(calls[0]?.url).toBe(
      'https://automate-artifacts.objects.example.com/runs/run-1/report.json',
    );
    expect((calls[0]?.init.headers as Record<string, string>)['host']).toBe(
      'automate-artifacts.objects.example.com',
    );
  });

  it('honours an endpoint path prefix', async () => {
    const { store, calls } = stubbedStore({
      forcePathStyle: true,
      endpoint: 'https://gw.example.com/s3/',
    });
    await store.get('runs/run-1/report.json');
    expect(calls[0]?.url).toBe(
      'https://gw.example.com/s3/automate-artifacts/runs/run-1/report.json',
    );
  });

  it('rejects an oversized artifact before touching the network', async () => {
    const { store, calls } = stubbedStore({ maxBytes: 4 });
    await expect(store.put('runs/run-1/big.bin', bytes('12345'))).rejects.toThrow(
      'Artifact is 5 bytes, above the 4-byte object store limit',
    );
    expect(calls).toHaveLength(0);
  });

  it('validates the storage key before any request', async () => {
    const { store, calls } = stubbedStore();
    await expect(store.put('../escape', bytes('x'))).rejects.toThrow('traversal');
    await expect(store.get('/absolute')).rejects.toThrow('must be relative');
    expect(calls).toHaveLength(0);
  });
});

describe('S3ArtifactBytesStore response handling', () => {
  function storeReturning(response: () => Response, overrides: Partial<ObjectStoreSettings> = {}) {
    return new S3ArtifactBytesStore(
      { ...SETTINGS, ...overrides },
      {
        now: () => FIXED_DATE,
        fetch: (() => Promise.resolve(response())) as unknown as typeof fetch,
      },
    );
  }

  it('returns null for a missing object and throws for other failures', async () => {
    await expect(
      storeReturning(
        () => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
      ).get('runs/run-1/missing'),
    ).resolves.toBeNull();
    await expect(
      storeReturning(() => new Response('InternalError', { status: 500 })).get('runs/run-1/file'),
    ).rejects.toThrow('Object store get for runs/run-1/file failed with 500: InternalError');
  });

  it('reports a denied read instead of pretending the artifact is missing', async () => {
    await expect(
      storeReturning(() => new Response('AccessDenied', { status: 403 })).get('runs/run-1/file'),
    ).rejects.toThrow('failed with 403: AccessDenied');
  });

  it('returns stored bytes and empty objects', async () => {
    const payload = bytes('{"passed":true}');
    await expect(
      storeReturning(() => new Response(payload, { status: 200 })).get('runs/run-1/file'),
    ).resolves.toEqual(payload);
    await expect(
      storeReturning(() => new Response('', { status: 200 })).get('runs/run-1/empty'),
    ).resolves.toEqual(new Uint8Array());
  });

  it('refuses to read a body larger than the configured bound', async () => {
    await expect(
      storeReturning(() => new Response('0123456789', { status: 200 }), { maxBytes: 4 }).get(
        'runs/run-1/big',
      ),
    ).rejects.toThrow('above the 4-byte object store limit');
    const streaming = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes('01234'));
        controller.enqueue(bytes('56789'));
        controller.close();
      },
    });
    await expect(
      storeReturning(
        () => new Response(streaming, { status: 200, headers: { 'content-length': '5' } }),
        { maxBytes: 4 },
      ).get('runs/run-1/big'),
    ).rejects.toThrow('above the 4-byte object store limit');
  });

  it('surfaces a failed put with the object store status', async () => {
    const store = new S3ArtifactBytesStore(SETTINGS, {
      now: () => FIXED_DATE,
      fetch: (() =>
        Promise.resolve(
          new Response('SignatureDoesNotMatch', { status: 403 }),
        )) as unknown as typeof fetch,
    });
    await expect(store.put('runs/run-1/file', bytes('x'))).rejects.toThrow(
      'Object store put for runs/run-1/file failed with 403: SignatureDoesNotMatch',
    );
  });

  it('propagates a transport failure instead of reporting a miss', async () => {
    const store = new S3ArtifactBytesStore(SETTINGS, {
      now: () => FIXED_DATE,
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });
    await expect(store.get('runs/run-1/file')).rejects.toThrow('fetch failed');
  });
});

describe('S3ArtifactBytesStore against an S3-compatible server', () => {
  it('round trips authenticated bytes and reports a missing key as null', async () => {
    const fake = createFakeS3();
    const port = await listen(fake.server);
    openServers.push(fake.server);
    const store = new S3ArtifactBytesStore(
      { ...SETTINGS, endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true },
      { now: () => FIXED_DATE },
    );
    const key = 'runs/run-1/9f-report (1).json';
    const payload = bytes('{"passed":true}');
    await store.put(key, payload);
    expect(fake.objects.get('/automate-artifacts/runs/run-1/9f-report%20%281%29.json')).toEqual(
      Buffer.from(payload),
    );
    await expect(store.get(key)).resolves.toEqual(payload);
    await expect(store.get('runs/run-1/missing.json')).resolves.toBeNull();
  });

  it('fails the write when the object store does not accept the signature', async () => {
    const fake = createFakeS3();
    const port = await listen(fake.server);
    openServers.push(fake.server);
    const wrongSecret = new S3ArtifactBytesStore(
      {
        ...SETTINGS,
        endpoint: `http://127.0.0.1:${port}`,
        forcePathStyle: true,
        secretAccessKey: 'not-the-configured-secret',
      },
      { now: () => FIXED_DATE },
    );
    await expect(wrongSecret.put('runs/run-1/file', bytes('x'))).rejects.toThrow(
      'failed with 403: <Error><Code>SignatureDoesNotMatch</Code></Error>',
    );
    expect(fake.objects.size).toBe(0);
  });

  it('aborts a request that the object store never answers', async () => {
    const fake = createFakeS3('silent');
    const port = await listen(fake.server);
    openServers.push(fake.server);
    const store = new S3ArtifactBytesStore(
      { ...SETTINGS, endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true, timeoutMs: 60 },
      { now: () => FIXED_DATE },
    );
    await expect(store.get('runs/run-1/file')).rejects.toThrow();
  });
});

describe('S3ArtifactBytesStore defaults', () => {
  it('uses the global fetch and the wall clock when nothing is injected', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    try {
      const store = new S3ArtifactBytesStore({ ...SETTINGS });
      await expect(store.get('runs/run-1/file')).resolves.toEqual(new Uint8Array());
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
