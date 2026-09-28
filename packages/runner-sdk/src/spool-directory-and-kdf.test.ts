import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DurableSpool,
  EncryptedSpool,
  SpoolError,
  privateDirectoryProblem,
  type SpoolEntry,
} from './spool.js';

/**
 * The two properties that make a spool trustworthy: its key is **derived reproducibly**
 * or it is not, and its directory is **private** or a local account can tamper with the
 * queue.
 *
 * Written around the failure rather than the success. A test that opens a spool and
 * reads an entry back passes with or without the KDF parameters pinned, and passes with
 * or without the directory checks — which is why neither defect survived the existing
 * suite (ledger P-16 through P-19).
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runner-spool-guard-'));
  roots.push(root);
  return root;
}

const isPosix = process.platform !== 'win32';

/** A spool directory, so the repair cases read as one call site rather than two. */
async function privateDirectory(): Promise<string> {
  return directory();
}

/**
 * A complete frame.
 *
 * The torn-tail cases corrupt the file *after* a valid frame, because a partial write
 * leaves a valid prefix followed by bytes that promised more than arrived — which is
 * the only shape a short write can produce, and the shape the repair guard has to
 * recognise.
 */
function frame(id: string, sequence: number): SpoolEntry {
  return {
    id,
    jobId: `job-${id}`,
    kind: 'event',
    sequence,
    leaseId: 'lease-secret',
    fencingToken: sequence,
    payload: { id },
  };
}

describe('the spool KDF is pinned, not inherited', () => {
  it("actually passes those parameters to the KDF, rather than inheriting Node's", () => {
    // The assertion that can fail.
    //
    // A test that compares `deriveKey` against a computation using the same pinned
    // parameters is *incapable* of failing today, because Node's present defaults
    // happen to be exactly these values. That coincidence is the whole hazard: the fix
    // protects against a future change nobody can currently observe, and a comparison
    // of outputs cannot tell "pinned" from "inherited" while the two agree.
    //
    // So this perturbs the parameters and requires the derived key to move. If
    // `deriveKey` ignored `KDF_PARAMS` and fell back to defaults, the key would be
    // identical and this fails. Verified by reverting the call: this is the case that
    // catches it, and it is why the constant is mutated rather than merely read.
    const original = { ...EncryptedSpool.KDF_PARAMS };
    const withPinned = EncryptedSpool.deriveKey('a-secret-with-real-entropy');
    try {
      Object.assign(EncryptedSpool.KDF_PARAMS, { N: original.N * 2 });
      expect(EncryptedSpool.deriveKey('a-secret-with-real-entropy')).not.toEqual(withPinned);
    } finally {
      Object.assign(EncryptedSpool.KDF_PARAMS, original);
    }
  });

  it('derives the same key for the same secret across calls', () => {
    // This passed before the fix too, and that is the point: the old version was
    // deterministic *by accident*, on Node's current defaults. Reproducibility is not
    // the property at risk — the risk is reproducibility across a Node upgrade.
    expect(EncryptedSpool.deriveKey('a-secret')).toEqual(EncryptedSpool.deriveKey('a-secret'));
  });

  it("states its cost parameters rather than inheriting Node's defaults", () => {
    // The actual defect. A default change is not a performance tweak: it silently
    // produces different keys on every installation, and the only symptom is
    // SPOOL_WRONG_KEY on a spool nobody touched.
    expect(EncryptedSpool.KDF_PARAMS.N).toBeGreaterThanOrEqual(16_384);
    expect(EncryptedSpool.KDF_PARAMS.r).toBe(8);
    expect(EncryptedSpool.KDF_PARAMS.p).toBe(1);
    // Node raises rather than succeeding once N grows past its default maxmem, so this
    // is what keeps a future parameter bump a detectable event instead of a hard error.
    expect(EncryptedSpool.KDF_PARAMS.maxmem).toBeGreaterThan(32 * 1024 * 1024);
  });

  it('declares a positive KDF version, which is what makes a parameter bump visible', () => {
    // The version is folded into `keyId`, and `DurableSpool.open` already compares the
    // key id against the one recorded beside the sequence state — so a future change to
    // `KDF_PARAMS` produces a deliberate mismatch rather than an unexplained one. What a
    // test can honestly verify is that the version exists and is a usable value;
    // proving the folding would need a second version to compare against, and inventing
    // one here would test the test.
    expect(EncryptedSpool.KDF_VERSION).toBeTypeOf('number');
    expect(EncryptedSpool.KDF_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('gives each key material a distinct, stable, hex-shaped key id', () => {
    // This id is what decides whether a spool is readable at all, so all three
    // properties matter: stable for a key, distinct across keys, and the promised shape.
    const one = new EncryptedSpool(Buffer.alloc(32, 7)).keyId();
    const same = new EncryptedSpool(Buffer.alloc(32, 7)).keyId();
    const other = new EncryptedSpool(Buffer.alloc(32, 9)).keyId();

    expect(one).toBe(same);
    expect(one).not.toBe(other);
    expect(one).toMatch(/^[a-f0-9]{32}$/u);
  });

  it('separates two purposes sharing one secret', () => {
    // The purpose string is a domain separator, not a secret salt. It was never the
    // defect; the missing versioning was.
    expect(EncryptedSpool.deriveKey('a-secret', 'purpose-a')).not.toEqual(
      EncryptedSpool.deriveKey('a-secret', 'purpose-b'),
    );
  });

  it('refuses an empty secret', () => {
    expect(() => EncryptedSpool.deriveKey('')).toThrow(SpoolError);
  });
});

describe('the spool directory is private', () => {
  it('reports which guards this platform actually exercised', () => {
    // Never fails, and that is the design. Four of these guards are POSIX-only, so on
    // Windows they do not run at all — and a skipped assertion is indistinguishable
    // from a passing one in a test report. This exists so a green run cannot be read
    // as "the permission guards hold" when on this host they were never checked.
    if (isPosix) {
      console.info('spool directory guards: all exercised (POSIX)');
      return;
    }
    console.info(
      'spool directory guards: 4 of 4 SKIPPED on ' +
        process.platform +
        ' — owner-only mode, refuse a reachable directory, refuse a world-writable ' +
        'directory, accept a private directory. `stat` reports a synthetic mode here, ' +
        'so those guards are POSIX-only by design and are UNVERIFIED on this host.',
    );
  });

  it('creates the directory owner-only', async () => {
    if (!isPosix) return;
    const root = await directory();
    const spoolDirectory = join(root, 'nested', 'spool');
    await DurableSpool.open({ directory: spoolDirectory, key: 'k'.repeat(43) });
    const mode = (await stat(spoolDirectory)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('refuses a directory another local account can reach', async () => {
    if (!isPosix) return;
    // The pre-created-directory attack. `mkdir(..., { recursive: true })` succeeds
    // whether it created the directory or found one, so a permissive directory left or
    // planted by another account is silently adopted — and 0o700 applied to a foreign
    // directory protects nothing at all.
    const root = await directory();
    const spoolDirectory = join(root, 'shared');
    await mkdir(spoolDirectory, { recursive: true, mode: 0o755 });
    await expect(
      DurableSpool.open({ directory: spoolDirectory, key: 'k'.repeat(43) }),
    ).rejects.toThrow(/accessible beyond this account/);
  });

  it('refuses a world-writable directory', async () => {
    if (!isPosix) return;
    const root = await directory();
    const spoolDirectory = join(root, 'open');
    await mkdir(spoolDirectory, { recursive: true, mode: 0o700 });
    await chmod(spoolDirectory, 0o777);
    await expect(
      DurableSpool.open({ directory: spoolDirectory, key: 'k'.repeat(43) }),
    ).rejects.toThrow(/accessible beyond this account/);
  });

  it('rejects a path that is a file rather than a directory', async () => {
    const root = await directory();
    const notADirectory = join(root, 'a-file');
    await writeFile(notADirectory, 'not a directory', 'utf8');
    await expect(
      DurableSpool.open({ directory: notADirectory, key: 'k'.repeat(43) }),
    ).rejects.toThrow(/not a directory/);
  });

  it('accepts a directory it owns and keeps at 0700', async () => {
    if (!isPosix) return;
    const root = await directory();
    const spoolDirectory = join(root, 'ok');
    const spool = await DurableSpool.open({ directory: spoolDirectory, key: 'k'.repeat(43) });
    await expect(spool.peek()).resolves.toEqual([]);
  });

  it('still round-trips an entry in a private directory', async () => {
    // The positive case, so the guards above are not the only thing asserted: a spool
    // that refuses everything is not a fix either.
    const spool = await DurableSpool.open({
      directory: await directory(),
      key: 'k'.repeat(43),
    });
    const entry: SpoolEntry = {
      id: 'e1',
      jobId: 'job-1',
      kind: 'event',
      sequence: 1,
      leaseId: 'lease-secret',
      fencingToken: 3,
      payload: { a: 1 },
    };
    await spool.enqueue(entry);
    await expect(spool.peek()).resolves.toHaveLength(1);
  });
});

/**
 * A stat-shaped object, so the policy is exercisable without a filesystem.
 *
 * The shape mirrors the three fields `privateDirectoryProblem` reads and nothing else,
 * so a change to the policy's inputs shows up here as a type error rather than as a
 * test that quietly stops meaning anything.
 */
const stats = (overrides: { isDirectory?: () => boolean; mode?: number; uid?: number } = {}) => ({
  isDirectory: () => true,
  mode: 0o40700,
  uid: 1000,
  ...overrides,
});

describe('the spool directory policy, independent of the platform it runs on', () => {
  // Every branch of `privateDirectoryProblem`, reachable on any host, because the
  // decision is a pure function of a stat result rather than something only a POSIX
  // filesystem can produce. This is what replaced four POSIX-only file tests that
  // silently did nothing on Windows — a suite that is green because it skipped is the
  // failure this repository is organized against, so the policy is testable everywhere
  // and the file tests are left as the integration check they are.

  it('accepts an owner-only directory we own', () => {
    expect(privateDirectoryProblem(stats(), 'linux', 1000)).toBeNull();
  });

  it('rejects a path that is not a directory', () => {
    expect(privateDirectoryProblem(stats({ isDirectory: () => false }), 'linux', 1000)).toMatch(
      /not a directory/,
    );
  });

  it('rejects a group-accessible directory', () => {
    expect(privateDirectoryProblem(stats({ mode: 0o40750 }), 'linux', 1000)).toMatch(
      /accessible beyond this account/,
    );
  });

  it('rejects a world-readable directory', () => {
    expect(privateDirectoryProblem(stats({ mode: 0o40704 }), 'linux', 1000)).toMatch(
      /accessible beyond this account/,
    );
  });

  it('rejects a directory owned by another uid, however private its mode', () => {
    // The assertion that matters most: 0700 on a foreign directory protects nothing,
    // because the owner can write to it whatever the mode says.
    expect(privateDirectoryProblem(stats({ uid: 4242 }), 'linux', 1000)).toMatch(
      /owned by uid 4242 and this process is uid 1000/,
    );
  });

  it('skips the permission checks on Windows, where the mode is synthetic', () => {
    // Not "passes on Windows" as a feature — an admission. 0666 is what `stat` reports
    // for a `mkdtemp` directory there, so checking the bits would refuse every
    // Windows install. The gap is named rather than papered over.
    expect(privateDirectoryProblem(stats({ mode: 0o40666, uid: 0 }), 'win32', null)).toBeNull();
  });

  it('still rejects a non-directory on Windows', () => {
    // The one check the platform can express, so it is not skipped along with the rest.
    expect(privateDirectoryProblem(stats({ isDirectory: () => false }), 'win32', null)).toMatch(
      /not a directory/,
    );
  });

  it('treats an unknown uid as no assertion rather than a mismatch', () => {
    // `getuid` is absent in some environments. Claiming a foreign directory there
    // would be inventing a fact, so ownership is simply not checked.
    expect(privateDirectoryProblem(stats({ uid: 7 }), 'linux', null)).toBeNull();
  });
});

describe('a torn append is repaired, not built upon', () => {
  // P-16's second half, and it was separately broken from the first. The first half —
  // a held handle, a checked byte count and a `datasync()` before the entry is
  // reported enqueued — is why a torn tail is now rare; this is what makes the rare
  // case *correct* when it still happens.
  //
  // The old repair guard read a **cached** `fileBytes`, so a failed append left the
  // guard believing the file ended where it last succeeded, and the next append landed
  // after the hole. The file then carried a gap in the middle of a frame stream, which
  // decodes as corruption rather than as a short tail.

  it('repairs a torn tail rather than appending after it', async () => {
    const directory = await privateDirectory();
    const spool = await DurableSpool.open({ directory, key: 'k'.repeat(43) });
    await spool.enqueue(frame('e1', 1));
    const path = join(directory, 'events.spool');

    // Simulate a power loss mid-append: bytes the file never finished receiving.
    const intact = await readFile(path);
    await writeFile(path, Buffer.concat([intact, Buffer.from([0x00, 0x01, 0x02])]));

    await spool.enqueue(frame('e2', 2));
    const repaired = await readFile(path);

    // Measured against a control rather than a guessed number. The first version
    // asserted `repaired.length < intact.length + 3` on the reasoning that the injected
    // bytes would simply be gone — which is wrong, because the repair truncates *and*
    // then appends e2's whole frame, so the file grows by a frame. Measuring what the
    // same frame costs on a clean spool gives the number the repair should have
    // produced, and the difference between the two is exactly the residue the guard
    // failed to remove.
    const control = await privateDirectory();
    const controlSpool = await DurableSpool.open({ directory: control, key: 'k'.repeat(43) });
    await controlSpool.enqueue(frame('e1', 1));
    const controlIntact = await readFile(join(control, 'events.spool'));
    await controlSpool.enqueue(frame('e2', 2));
    const cleanSize = (await readFile(join(control, 'events.spool'))).length;

    expect(repaired.length).toBe(cleanSize);
    // Had the guard kept the hole, the file would carry three extra bytes and decode as
    // corruption rather than as a clean two-frame stream.
    expect(repaired.length).toBeLessThan(
      controlIntact.length + 3 + (cleanSize - controlIntact.length),
    );

    const reopened = await DurableSpool.open({ directory, key: 'k'.repeat(43) });
    const ids = (await reopened.peek(10)).map((entry) => entry.id);
    expect(ids).toEqual(['e1', 'e2']);
  });

  it('keeps the committed entries readable after a torn tail and no appends', async () => {
    // A restart alone must not lose what was committed. With no write there is nothing
    // to repair, and the decoder must read the short tail as a tail rather than
    // refusing the whole file.
    const directory = await privateDirectory();
    const spool = await DurableSpool.open({ directory, key: 'k'.repeat(43) });
    await spool.enqueue(frame('e1', 1));
    const path = join(directory, 'events.spool');
    const intact = await readFile(path);
    await writeFile(path, Buffer.concat([intact, Buffer.from([0xff])]));

    const reopened = await DurableSpool.open({
      directory,
      key: 'k'.repeat(43),
      tornTail: 'drop',
    });
    expect((await reopened.peek(10)).map((entry) => entry.id)).toEqual(['e1']);
  });
});
