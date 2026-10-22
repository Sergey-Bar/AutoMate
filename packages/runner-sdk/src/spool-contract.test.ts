import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DurableSpool,
  EncryptedSpool,
  MemorySpool,
  SpoolCapacityError,
  SpoolError,
  SpoolFrameTooLargeError,
  SpoolIntegrityError,
  SpoolPathError,
  privateDirectoryProblem,
  type SpoolEntry,
} from './spool.js';

/**
 * Found by mutation testing: the existing suites exercised the spool's happy paths and
 * its main refusals, but not the error vocabulary an operator or a caller branches on
 * (`name`, `code`, message), the option validation at `open`, the on-disk state files'
 * validation, or the private-directory diagnosis. Each assertion here pins one of those.
 */
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runner-spool-contract-'));
  roots.push(root);
  return root;
}

function entry(id: string, sequence: number): SpoolEntry {
  return {
    id,
    jobId: 'job-1',
    kind: 'event',
    sequence,
    leaseId: 'lease',
    fencingToken: 1,
    payload: { id },
  };
}

describe('the spool error classes', () => {
  it('each carries its own name and the right ancestry, because callers branch on both', () => {
    const cases: Array<[Error, string]> = [
      [new SpoolError('m'), 'SpoolError'],
      [new SpoolPathError('m'), 'SpoolPathError'],
      [new SpoolCapacityError('m'), 'SpoolCapacityError'],
      [new SpoolFrameTooLargeError(10, 20), 'SpoolFrameTooLargeError'],
      [new SpoolIntegrityError('SPOOL_TAMPERED', 'm'), 'SpoolIntegrityError'],
    ];
    for (const [error, name] of cases) {
      expect(error.name).toBe(name);
      expect(error).toBeInstanceOf(SpoolError);
    }
  });

  it('the frame-limit error states both sizes and what to do', () => {
    const error = new SpoolFrameTooLargeError(1000, 2500);
    expect(error.limitBytes).toBe(1000);
    expect(error.entryBytes).toBe(2500);
    expect(error.message).toContain('2500 bytes');
    expect(error.message).toContain('1000-byte frame limit');
    expect(error.message).toContain('split it, or reduce what the event carries.');
  });
});

describe('privateDirectoryProblem', () => {
  const dir = (mode: number, uid = 1000) => ({ isDirectory: () => true, mode, uid });

  it('refuses a path that is not a directory, on every platform', () => {
    const file = { isDirectory: () => false, mode: 0o100600, uid: 1000 };
    expect(privateDirectoryProblem(file, 'linux', 1000)).toBe('the path is not a directory');
    expect(privateDirectoryProblem(file, 'win32', null)).toBe('the path is not a directory');
  });

  it('does not judge POSIX modes on Windows', () => {
    expect(privateDirectoryProblem(dir(0o40777), 'win32', 1000)).toBeNull();
  });

  it('accepts an owner-only directory owned by this uid', () => {
    expect(privateDirectoryProblem(dir(0o40700), 'linux', 1000)).toBeNull();
  });

  it.each([0o40750, 0o40705, 0o40755, 0o40770, 0o40707])(
    'refuses mode %o as accessible beyond this account',
    (mode) => {
      const problem = privateDirectoryProblem(dir(mode), 'linux', 1000);
      expect(problem).toContain(`is mode 0${(mode & 0o777).toString(8)}`);
      expect(problem).toContain('chmod it to 0700');
    },
  );

  it('refuses a directory owned by another uid however private its mode', () => {
    const problem = privateDirectoryProblem(dir(0o40700, 0), 'linux', 1000);
    expect(problem).toContain('is owned by uid 0 and this process is uid 1000');
    expect(problem).toContain('Another account can write to it whatever its mode says.');
  });

  it('skips the ownership check where the platform has no uid', () => {
    expect(privateDirectoryProblem(dir(0o40700, 0), 'linux', null)).toBeNull();
  });

  it('a uid of zero is a uid, not "no uid"', () => {
    // `process.getuid?.() ?? null` survived as `&&`, which turns root's uid 0 into null
    // and silently skips the ownership check for exactly the account that matters most.
    expect(privateDirectoryProblem(dir(0o40700, 1000), 'linux', 0)).toContain('owned by uid 1000');
  });
});

describe('EncryptedSpool', () => {
  const KEY = Buffer.alloc(32, 7);

  it('refuses an empty key secret, by name', () => {
    expect(() => EncryptedSpool.deriveKey('')).toThrow('Spool key secret must not be empty');
  });

  it('derives different keys for different purposes and the same key for the same one', () => {
    const a = EncryptedSpool.deriveKey('secret', 'purpose-a');
    expect(a.equals(EncryptedSpool.deriveKey('secret', 'purpose-a'))).toBe(true);
    expect(a.equals(EncryptedSpool.deriveKey('secret', 'purpose-b'))).toBe(false);
    expect(a.equals(EncryptedSpool.deriveKey('secret'))).toBe(false);
    expect(a).toHaveLength(32);
  });

  it('the key id is a prefix of sha256("v<version>:" + key), so a KDF bump changes it', () => {
    const id = new EncryptedSpool(KEY).keyId();
    const full = createHash('sha256').update('v1:').update(KEY).digest('hex');
    expect(EncryptedSpool.KDF_VERSION).toBe(1);
    expect(id).toBe(full.slice(0, 32));
  });

  it('distinguishes a truncated frame from a tampered one at the envelope boundary', () => {
    const codec = new EncryptedSpool(KEY);
    // The smallest sealed frame is the iv and the tag with an empty ciphertext.
    const minimum = codec.seal('x').length - '"x"'.length;
    const truncated = Buffer.alloc(minimum - 1);
    expect(() => codec.open(truncated)).toThrow(SpoolIntegrityError);
    try {
      codec.open(truncated);
    } catch (error) {
      expect((error as SpoolIntegrityError).code).toBe('SPOOL_TRUNCATED');
      expect((error as Error).message).toBe('Spool frame is shorter than its envelope');
    }
    try {
      codec.open(Buffer.alloc(minimum));
      expect.unreachable('an all-zero frame must not authenticate');
    } catch (error) {
      expect((error as SpoolIntegrityError).code).toBe('SPOOL_TAMPERED');
      expect((error as Error).message).toBe('Spool frame failed authentication');
    }
  });

  it('reports an authentic frame whose payload is not JSON as a format fault, not tampering', () => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    const body = Buffer.concat([cipher.update('not json {', 'utf8'), cipher.final()]);
    const frame = Buffer.concat([iv, cipher.getAuthTag(), body]);
    try {
      new EncryptedSpool(KEY).open(frame);
      expect.unreachable('invalid JSON must not open');
    } catch (error) {
      expect((error as SpoolIntegrityError).code).toBe('SPOOL_FORMAT');
      expect((error as Error).message).toBe('Spool frame payload is not valid JSON');
    }
  });

  it('seals UTF-8 and opens it back unchanged', () => {
    const codec = new EncryptedSpool(KEY);
    expect(codec.open(codec.seal({ text: 'na\u00efve \u2014 \u2713' }))).toEqual({
      text: 'na\u00efve \u2014 \u2713',
    });
  });
});

describe('MemorySpool', () => {
  it('refuses an entry past capacity with the capacity error, and keeps what it has', async () => {
    const spool = new MemorySpool(1);
    await spool.enqueue(entry('a', 1));
    await expect(spool.enqueue(entry('b', 2))).rejects.toThrow('Runner spool is full');
    await expect(spool.enqueue(entry('b', 2))).rejects.toBeInstanceOf(SpoolCapacityError);
    expect((await spool.peek()).map((item) => item.id)).toEqual(['a']);
  });

  it('acknowledging one entry removes that entry and only that entry', async () => {
    const spool = new MemorySpool();
    await spool.enqueue(entry('a', 1));
    await spool.enqueue(entry('b', 2));
    await spool.ack(['a']);
    expect((await spool.peek()).map((item) => item.id)).toEqual(['b']);
  });
});

describe('DurableSpool.open validation', () => {
  it.each([{ maxEntries: 0 }, { maxBytes: 0 }, { compactThresholdBytes: 0 }, { maxEntries: -1 }])(
    'refuses non-positive limits %j',
    async (limits) => {
      const root = await directory();
      await expect(DurableSpool.open({ directory: root, key: 'k', ...limits })).rejects.toThrow(
        'Runner spool limits must be positive',
      );
    },
  );

  it('accepts a limit of exactly one', async () => {
    const root = await directory();
    const spool = await DurableSpool.open({
      directory: root,
      key: 'k',
      maxEntries: 1,
      maxBytes: 1,
      compactThresholdBytes: 1,
    });
    expect(await spool.peek()).toEqual([]);
  });

  it('names a file sitting where the spool directory belongs, and keeps the cause', async () => {
    const root = await directory();
    const occupied = join(root, 'spool');
    await writeFile(occupied, 'a file');
    try {
      await DurableSpool.open({ directory: occupied, key: 'k' });
      expect.unreachable('a file is not a spool directory');
    } catch (error) {
      expect(error).toBeInstanceOf(SpoolError);
      expect((error as Error).message).toContain(`Spool path is not a directory: ${occupied}`);
      expect((error as Error).message).toContain('cannot create a private spool directory');
      expect((error as Error).cause).toBeDefined();
    }
  });

  it.each(['../escape', 'a/b', 'a\\b', '', '..'])('refuses the file name %j', async (name) => {
    const root = await directory();
    await expect(DurableSpool.open({ directory: root, key: 'k', name })).rejects.toBeInstanceOf(
      SpoolPathError,
    );
  });
});

describe('DurableSpool state files', () => {
  async function openWith(files: Record<string, string>) {
    const root = await directory();
    for (const [suffix, body] of Object.entries(files)) {
      await writeFile(join(root, `events.spool${suffix}`), body);
    }
    return DurableSpool.open({ directory: root, key: 'state-key' });
  }

  const keyId = new EncryptedSpool('state-key').keyId();

  it.each([
    ['not json', 'Runner spool acknowledgement state is invalid'],
    ['{"a":1}', 'Runner spool acknowledgement state is invalid'],
    ['[1]', 'Runner spool acknowledgement state is invalid'],
    ['[""]', 'Runner spool acknowledgement state is invalid'],
  ])('refuses acknowledgement state %s', async (body, message) => {
    await expect(openWith({ '.acks': body })).rejects.toMatchObject({
      name: 'SpoolIntegrityError',
      code: 'SPOOL_FORMAT',
      message,
    });
  });

  it.each([
    ['not json', 'SPOOL_FORMAT', 'Runner spool sequence state is not valid JSON'],
    ['null', 'SPOOL_FORMAT', 'Runner spool sequence state is not an object'],
    ['7', 'SPOOL_FORMAT', 'Runner spool sequence state is not an object'],
    [
      JSON.stringify({ keyId: 'someone-elses', sequences: {} }),
      'SPOOL_WRONG_KEY',
      'Runner spool sequence state key does not match',
    ],
    [
      JSON.stringify({ keyId, sequences: [] }),
      'SPOOL_FORMAT',
      'Runner spool sequence state is invalid',
    ],
    [JSON.stringify({ keyId }), 'SPOOL_FORMAT', 'Runner spool sequence state is invalid'],
    [
      JSON.stringify({ keyId, sequences: { 'job-1': -1 } }),
      'SPOOL_FORMAT',
      'Runner spool sequence state is invalid',
    ],
    [
      JSON.stringify({ keyId, sequences: { 'job-1': 1.5 } }),
      'SPOOL_FORMAT',
      'Runner spool sequence state is invalid',
    ],
    [
      JSON.stringify({ keyId, sequences: { '': 1 } }),
      'SPOOL_FORMAT',
      'Runner spool sequence state is invalid',
    ],
  ])('refuses sequence state %s', async (body, code, message) => {
    await expect(openWith({ '.sequences': body })).rejects.toMatchObject({ code, message });
  });

  it('accepts a sequence of zero, which is a valid starting point', async () => {
    const spool = await openWith({
      '.sequences': JSON.stringify({ keyId, sequences: { 'job-1': 0 } }),
    });
    expect(await spool.peek()).toEqual([]);
  });
});
