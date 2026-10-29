/**
 * The runner (Phase 2, requirements R-020 to R-030, threats T-01 to T-08 and T-11).
 *
 * Runs ONE command the user has seen and agreed to, on this computer, as this user. It is
 * not a sandbox and says so in every preview: the command can read and change anything the
 * user can, and use the network. What it does provide is narrower, and each part is tested:
 *
 * - argument vector only: no shell is involved, so a metacharacter in an argument is data;
 * - consent bound to the exact request: the preview returns a digest of the canonical
 *   request, and a start whose digest differs is refused;
 * - working directory and report paths must resolve inside the chosen repository;
 * - the environment is an allowlist plus named variables, never the whole parent
 *   environment, and values of secret-looking names are redacted from output;
 * - a mandatory deadline, a cancel, and an output size limit, all of which end the command
 *   AND everything it started (a Windows job object; a POSIX process group, written but not
 *   run on the host this was built on), then check the process it started is gone;
 * - one run at a time;
 * - output goes to files, is redacted after the run, and only the redacted copy is kept.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { clearInterval, setInterval } from 'node:timers';
import { TextDecoder } from 'node:util';
import { resolveInside } from './detect.mjs';
import { readFileBoundedSync } from './bounded-read.mjs';
import { launch } from './proctree.mjs';
import { PLACEHOLDER, redactPersonal, redactSecrets } from './redact.mjs';

export const NOTICE =
  'This command runs on this computer, as you, with your permissions. It is not isolated: it can read and change any file you can, and use the network. It ends when the deadline passes or you cancel, along with the processes it started.';

export const DEFAULT_LIMITS = {
  maxArgs: 256,
  maxArgBytes: 8192,
  maxEnvEntries: 64,
  maxCommandLine: 30_000,
  maxDeadlineSeconds: 24 * 60 * 60,
  maxOutputBytes: 16 * 1024 * 1024,
  tailBytes: 256 * 1024,
  pollMs: 100,
  terminateWaitMs: 8000,
  staleSlackMs: 2000,
};

const WINDOWS_BASE_ENV = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
];
const POSIX_BASE_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'];

/** Names whose values are treated as secrets without being told. */
const SECRET_NAME = /secret|token|passw|credential|api[_-]?key|private[_-]?key|auth/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_()]*$/;
/** What cmd.exe would interpret. A `.cmd`/`.bat` target is refused if an argument has any. */
const CMD_META = /[&|<>^%!"\r\n]/;
/** Exit codes the Windows launcher uses for its own failures (see job-launcher.ps1). */
const LAUNCHER_NO_JOB = new Set([3000101, 3000102, 3000103]);
const LAUNCHER_NO_START = 3000104;

export class RunnerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   * @param {unknown} [details]
   */
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** @param {string} value */
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** @param {number} pid */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {{ code?: string }} */ (error).code === 'EPERM';
  }
}

/**
 * Quotes one argument for a Windows command line, by the rules the C runtime parses.
 *
 * @param {string} arg
 */
export function quoteWindowsArg(arg) {
  if (arg !== '' && !/[ \t\n\v"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes += 1;
    } else if (char === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes) + char;
      backslashes = 0;
    }
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} host
 * @param {boolean} windows
 * @returns {string | undefined}
 */
function hostValue(name, host, windows) {
  if (!windows) return host[name];
  const key = Object.keys(host).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : host[key];
}

/**
 * @param {string} command
 * @param {{ cwd: string, host: Record<string, string | undefined>, windows: boolean }} where
 * @returns {string | null} an absolute path to a file, or null
 */
export function resolveExecutable(command, where) {
  const extensions = where.windows
    ? (hostValue('PATHEXT', where.host, true) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  /** @param {string} base */
  const probe = (base) => {
    const candidates =
      where.windows && path.extname(base) === '' ? extensions.map((ext) => base + ext) : [base];
    if (where.windows && path.extname(base) !== '')
      candidates.push(...extensions.map((ext) => base + ext));
    for (const candidate of candidates) {
      try {
        if (!statSync(candidate).isFile()) continue;
        if (!where.windows) accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not this one
      }
    }
    return null;
  };
  if (path.isAbsolute(command)) return probe(command);
  if (/[\\/]/.test(command)) return probe(path.resolve(where.cwd, command));
  const dirs = (hostValue('PATH', where.host, where.windows) ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of where.windows ? [where.cwd, ...dirs] : dirs) {
    const found = probe(path.join(dir, command));
    if (found !== null) return found;
  }
  return null;
}

/** @param {Uint8Array} buffer */
function decode(buffer) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

/**
 * Opens a file for reading, or null when it does not exist. One call rather than an
 * existence check and then an open, which a rename between them would race
 * (CodeQL js/file-system-race).
 *
 * @param {string} file
 * @returns {number | null}
 */
function openIfPresent(file) {
  try {
    return openSync(file, 'r');
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * @param {{ engine: ReturnType<import('./engine.mjs').createEngine>, dataDir: string,
 *   now?: () => Date, host?: Record<string, string | undefined>, platform?: string,
 *   limits?: Partial<typeof DEFAULT_LIMITS>, launcher?: typeof launch,
 *   approach?: string }} options
 */
export function createRunner(options) {
  const { engine } = options;
  const store = engine.store;
  const now = options.now ?? (() => new Date());
  const host = options.host ?? process.env;
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const launcher = options.launcher ?? launch;
  const approach = options.approach ?? (windows ? 'job-object' : 'process-group');
  const runsDir = path.join(options.dataDir, 'runs');

  /** @type {{ id: string, cancel: (reason: string) => void } | null} */
  let active = null;
  /** @type {Map<string, Promise<void>>} */
  const settled = new Map();
  /** @type {Map<string, string[]>} secrets registered for runs in this process */
  const secretsOf = new Map();

  /** @param {string} id */
  const runDir = (id) => path.join(runsDir, id);

  // A run still marked running belongs to a process that ended; its raw output must not linger.
  for (const id of store.markInterruptedExecutions(now().toISOString())) {
    finalizeOutput(id, [], null);
    engine.events.emit('run.finished', { id, state: 'crashed' });
  }

  /**
   * Replaces the raw output files with redacted copies and deletes the raw ones. Fails
   * closed: if the redacted copy cannot be made, the output is withheld.
   *
   * @param {string} id
   * @param {string[]} secrets
   * @param {string | null} root
   */
  function finalizeOutput(id, secrets, root) {
    const dir = runDir(id);
    const info = {
      stdoutBytes: 0,
      stderrBytes: 0,
      withheld: false,
      secretsRegistered: secrets.length > 0,
    };
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      const raw = path.join(dir, `${stream}.raw`);
      try {
        const read = readFileBoundedSync(raw, limits.maxOutputBytes * 2);
        if (read.status === 'not-a-file') throw new Error('not-a-file');
        info[`${stream}Bytes`] = read.info.size;
        if (read.status === 'too-large') throw new Error('too-large-to-redact');
        const text = decode(read.bytes);
        const redacted = redactPersonal(redactSecrets(text, secrets), {
          roots: root === null ? [] : [root],
        });
        writeFileSync(path.join(dir, `${stream}.txt`), redacted, 'utf8');
      } catch (error) {
        // A stream the child never wrote is not withheld output.
        if (/** @type {{ code?: string }} */ (error).code !== 'ENOENT') info.withheld = true;
      } finally {
        rmSync(raw, { force: true });
      }
    }
    try {
      store.updateExecution(id, { output: info });
    } catch {
      // the record is already gone; nothing to update
    }
    return info;
  }

  /** @param {any} request */
  async function plan(request) {
    if (request === null || typeof request !== 'object')
      throw new RunnerError('INVALID_REQUEST', 'The request must be an object.');
    const repository = store.getRepository(String(request.repositoryId ?? ''));
    if (repository === undefined)
      throw new RunnerError('REPOSITORY_NOT_FOUND', 'No such repository.', 404);
    const root = repository.root_path;

    const argv = request.argv;
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string'))
      throw new RunnerError('INVALID_REQUEST', 'argv must be a non-empty list of strings.');
    if (argv.length > limits.maxArgs)
      throw new RunnerError('INVALID_REQUEST', 'Too many arguments.');
    for (const arg of argv) {
      if (
        arg.includes('\0') ||
        Buffer.byteLength(arg) > limits.maxArgBytes ||
        (argv[0] === '' && arg === '')
      )
        throw new RunnerError(
          'INVALID_REQUEST',
          'An argument is empty where a command is needed, too long, or contains a NUL.',
        );
    }
    if (argv[0] === '') throw new RunnerError('INVALID_REQUEST', 'The command is empty.');

    const deadline = request.deadlineSeconds;
    if (deadline === undefined || deadline === null)
      throw new RunnerError('DEADLINE_REQUIRED', 'A deadline is required: every run must end.');
    if (!Number.isInteger(deadline) || deadline < 1 || deadline > limits.maxDeadlineSeconds)
      throw new RunnerError(
        'INVALID_REQUEST',
        `The deadline must be a whole number of seconds from 1 to ${String(
          limits.maxDeadlineSeconds,
        )}.`,
      );

    const cwdRelative =
      request.cwd === undefined || request.cwd === '' || request.cwd === '.'
        ? '.'
        : String(request.cwd);
    let cwd = root;
    if (cwdRelative !== '.') {
      const inside = await resolveInside(root, cwdRelative);
      const isDir =
        inside !== null && (await stat(inside).catch(() => null))?.isDirectory() === true;
      if (inside === null || !isDir)
        throw new RunnerError(
          'CWD_OUTSIDE_REPOSITORY',
          'The working directory must be an existing folder inside the repository.',
        );
      cwd = inside;
    }

    const artifactPaths = request.artifactPaths ?? [];
    if (
      !Array.isArray(artifactPaths) ||
      artifactPaths.some((p) => typeof p !== 'string' || p === '')
    )
      throw new RunnerError(
        'INVALID_REQUEST',
        'artifactPaths must be a list of repository-relative paths.',
      );
    for (const artifact of artifactPaths) {
      const posixed = artifact.replaceAll('\\', '/');
      if (
        posixed.startsWith('/') ||
        /^[A-Za-z]:/.test(posixed) ||
        posixed.split('/').includes('..') ||
        artifact.includes('\0')
      )
        throw new RunnerError(
          'INVALID_REQUEST',
          `The report path "${artifact}" must be relative and stay inside the repository.`,
        );
    }

    // Environment: allowlist, plus names the user passes through, plus explicit values.
    /** @type {Record<string, string>} */
    const env = {};
    for (const name of windows ? WINDOWS_BASE_ENV : POSIX_BASE_ENV) {
      const value = hostValue(name, host, windows);
      if (value !== undefined) env[name] = value;
    }
    const passThrough = [...new Set(request.passThrough ?? [])];
    const explicit = request.env ?? {};
    if (
      !Array.isArray(passThrough) ||
      passThrough.some((n) => typeof n !== 'string' || !ENV_NAME.test(n))
    )
      throw new RunnerError('INVALID_REQUEST', 'passThrough must be a list of variable names.');
    if (typeof explicit !== 'object' || explicit === null || Array.isArray(explicit))
      throw new RunnerError('INVALID_REQUEST', 'env must be an object of names and values.');
    if (passThrough.length + Object.keys(explicit).length > limits.maxEnvEntries)
      throw new RunnerError('INVALID_REQUEST', 'Too many environment variables.');
    /** @type {string[]} */
    const secrets = [];
    for (const name of passThrough) {
      const value = hostValue(name, host, windows);
      if (value === undefined)
        throw new RunnerError(
          'INVALID_REQUEST',
          `The variable ${name} is not set here, so it cannot be passed through.`,
        );
      env[name] = value;
      if (SECRET_NAME.test(name)) secrets.push(value);
    }
    for (const [name, value] of Object.entries(explicit)) {
      if (
        !ENV_NAME.test(name) ||
        typeof value !== 'string' ||
        value.includes('\0') ||
        Buffer.byteLength(value) > limits.maxArgBytes
      )
        throw new RunnerError('INVALID_REQUEST', `The variable ${name} is not valid.`);
      env[name] = value;
      if (SECRET_NAME.test(name)) secrets.push(value);
    }
    for (const extra of request.secrets ?? []) if (typeof extra === 'string') secrets.push(extra);

    // The executable.
    const resolved = resolveExecutable(argv[0], { cwd, host: { ...host, ...env }, windows });
    if (resolved === null)
      throw new RunnerError('EXECUTABLE_NOT_FOUND', `"${argv[0]}" was not found.`);
    if (/[\\/]/.test(argv[0]) && !path.isAbsolute(argv[0])) {
      const inside = await resolveInside(root, path.relative(root, resolved) || '.');
      if (inside === null)
        throw new RunnerError(
          'EXECUTABLE_OUTSIDE_REPOSITORY',
          'A relative executable must be inside the repository.',
        );
    }

    // Build the command line for this platform.
    const shim = windows && /\.(cmd|bat)$/i.test(resolved);
    let file = resolved;
    let args = argv.slice(1);
    let verbatim = false;
    if (windows) {
      if (shim) {
        const unsafe = [resolved, ...args].find((a) => CMD_META.test(a));
        if (unsafe !== undefined)
          throw new RunnerError(
            'UNSAFE_ARGUMENT',
            'This command runs through cmd.exe, which would interpret one of its characters (& | < > ^ % ! " or a line break). Run the program behind the .cmd file directly, or remove the character.',
          );
        file = hostValue('ComSpec', host, true) ?? 'cmd.exe';
        args = ['/d', '/s', '/c', `"${[resolved, ...args].map(quoteWindowsArg).join(' ')}"`];
      } else {
        args = args.map(quoteWindowsArg);
      }
      verbatim = true;
      if ([file, ...args].join(' ').length > limits.maxCommandLine)
        throw new RunnerError('INVALID_REQUEST', 'The command line is too long for Windows.');
    }

    const canonical = {
      root,
      argv,
      resolved,
      cwd,
      env: Object.keys(explicit)
        .sort()
        .map((name) => [name, sha256(String(explicit[name]))]),
      passThrough: [...passThrough].sort(),
      deadlineSeconds: deadline,
      artifactPaths: [...artifactPaths].map((p) => p.replaceAll('\\', '/')).sort(),
    };
    return {
      repository,
      launch: { file, args, verbatim },
      secrets,
      env,
      view: {
        repositoryId: repository.id,
        argv,
        resolvedExecutable: resolved,
        viaCmdShim: shim,
        cwd,
        explicitEnvNames: Object.keys(explicit).sort(),
        passThroughNames: [...passThrough].sort(),
        deadlineSeconds: deadline,
        artifactPaths,
        approach,
        notice: NOTICE,
        platformNote: windows
          ? 'Processes the command starts are ended with it by a Windows job object.'
          : 'Processes the command starts are ended with it by a process group. This path is written but has not been run on a POSIX host.',
      },
      consentDigest: sha256(JSON.stringify(canonical)),
    };
  }

  /**
   * @param {string} id
   * @param {{ pid: number | undefined, terminate: () => Promise<unknown>, exited: Promise<number | null> }} handle
   */
  async function endTree(handle) {
    const started = Date.now();
    await handle.terminate();
    let timer;
    const gone = await Promise.race([
      handle.exited.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), limits.terminateWaitMs);
      }),
    ]);
    clearTimeout(timer);
    const rootGone = handle.pid === undefined ? true : gone && !isAlive(handle.pid);
    return { method: approach, rootGone, elapsedMs: Date.now() - started };
  }

  return {
    NOTICE,
    limits,

    /** Validates a request and returns exactly what would run, plus the digest to consent to. */
    async preview(request) {
      const p = await plan(request);
      return { plan: p.view, consentDigest: p.consentDigest };
    },

    /**
     * Starts the run if the consent digest matches this exact request.
     *
     * @param {any} request
     * @returns {Promise<{ id: string }>}
     */
    async start(request) {
      const p = await plan(request);
      if (typeof request.consentDigest !== 'string' || request.consentDigest !== p.consentDigest)
        throw new RunnerError(
          'CONSENT_MISMATCH',
          'What would run is not what was shown. Preview it again.',
          409,
        );
      if (active !== null)
        throw new RunnerError('BUSY', 'Another run is in progress. Only one run at a time.', 409);

      const id = randomBytes(8).toString('hex');
      if (request.retryOf !== undefined && store.getExecution(String(request.retryOf)) === null)
        throw new RunnerError('RUN_NOT_FOUND', 'The run being retried does not exist.', 404);
      const dir = runDir(id);
      mkdirSync(dir, { recursive: true });
      const startedAt = now();
      const storedArgv = p.view.argv.map((a) => redactSecrets(a, p.secrets));
      store.insertExecution({
        id,
        repositoryId: p.repository.id,
        retryOf: request.retryOf === undefined ? null : String(request.retryOf),
        argv: storedArgv,
        cwd: p.view.cwd,
        envNames: /** @type {any} */ ({
          explicit: p.view.explicitEnvNames,
          passThrough: p.view.passThroughNames,
        }),
        deadlineMs: p.view.deadlineSeconds * 1000,
        artifactPaths: p.view.artifactPaths,
        state: 'running',
        startedAt: startedAt.toISOString(),
        recordedAt: startedAt.toISOString(),
      });
      secretsOf.set(id, p.secrets);
      engine.events.emit('run.started', { id, repositoryId: p.repository.id });

      const outFd = openSync(path.join(dir, 'stdout.raw'), 'w');
      const errFd = openSync(path.join(dir, 'stderr.raw'), 'w');
      /** @type {ReturnType<typeof launch>} */
      let handle;
      try {
        handle = launcher({
          approach,
          file: p.launch.file,
          args: p.launch.args,
          stdio: ['ignore', outFd, errFd],
          cwd: p.view.cwd,
          env: p.env,
          options: p.launch.verbatim ? { windowsVerbatimArguments: true } : undefined,
        });
      } catch (error) {
        closeSync(outFd);
        closeSync(errFd);
        const reason = `the command could not be started (${
          /** @type {{ code?: string }} */ (error).code ?? 'error'
        })`;
        finalizeOutput(id, p.secrets, p.repository.root_path);
        store.updateExecution(id, {
          state: 'launch-failed',
          reason,
          finishedAt: now().toISOString(),
        });
        engine.events.emit('run.finished', { id, state: 'launch-failed' });
        return { id };
      }

      const live = handle;
      /** @type {string | null} */
      let ending = null;
      /** @type {Promise<{ method: string, rootGone: boolean, elapsedMs: number }> | null} */
      let termination = null;
      const ensureEnded = (/** @type {string} */ why) => {
        if (ending !== null) return;
        ending = why;
        termination = endTree(live);
      };
      active = { id, cancel: ensureEnded };

      const deadlineTimer = setTimeout(
        () => ensureEnded('deadline'),
        p.view.deadlineSeconds * 1000,
      );
      let lastSize = 0;
      const monitor = setInterval(() => {
        try {
          const size = fstatSync(outFd).size + fstatSync(errFd).size;
          if (size !== lastSize) {
            lastSize = size;
            engine.events.emit('run.output', { id, bytes: size });
          }
          if (size > limits.maxOutputBytes) ensureEnded('output-limit');
        } catch {
          // descriptors closed; the run is finishing
        }
      }, limits.pollMs);

      const done = (async () => {
        const exitCode = await live.exited;
        clearTimeout(deadlineTimer);
        clearInterval(monitor);
        const ended = termination === null ? null : await termination;
        try {
          closeSync(outFd);
          closeSync(errFd);
        } catch {
          // already closed
        }
        const output = finalizeOutput(id, p.secrets, p.repository.root_path);
        secretsOf.delete(id);

        /** @type {string} */
        let state;
        /** @type {string | null} */
        let reason = null;
        if (ending === 'deadline') {
          state = 'timed-out';
          reason = `the deadline of ${String(
            p.view.deadlineSeconds,
          )} s passed and the command was ended`;
        } else if (ending === 'cancelled') {
          state = 'cancelled';
          reason = 'cancelled by the user';
        } else if (ending === 'output-limit') {
          state = 'output-limit';
          reason = `the command wrote more than ${String(
            limits.maxOutputBytes,
          )} bytes and was ended`;
        } else if (windows && exitCode !== null && LAUNCHER_NO_JOB.has(exitCode)) {
          state = 'refused';
          reason =
            'the job object that ends every process the command starts could not be created, so nothing was run';
        } else if (windows && exitCode === LAUNCHER_NO_START) {
          state = 'launch-failed';
          reason = 'the command could not be started';
        } else if (exitCode === 0) {
          state = 'succeeded';
        } else {
          state = 'failed';
          reason =
            exitCode === null
              ? 'the command ended without an exit code'
              : `exit code ${String(exitCode)}`;
        }
        if (ended !== null && !ended.rootGone) {
          reason = `${
            reason ?? ''
          }; the process that was started could not be confirmed gone`.replace(/^; /, '');
        }

        const collection = await collect(
          p,
          startedAt.getTime(),
          state === 'refused' || state === 'launch-failed',
        );
        store.updateExecution(id, {
          state,
          reason,
          exitCode,
          finishedAt: now().toISOString(),
          termination: ended === null ? null : JSON.stringify(ended),
          output,
          collection,
        });
        if (active?.id === id) active = null;
        engine.events.emit('run.finished', { id, state, exitCode, collection: collection.status });
      })().catch((error) => {
        if (active?.id === id) active = null;
        try {
          store.updateExecution(id, {
            state: 'crashed',
            reason: `the runner failed while finishing this run (${String(
              /** @type {Error} */ (error).message,
            )})`,
            finishedAt: now().toISOString(),
          });
        } catch {
          // nothing more can be done
        }
        engine.events.emit('run.finished', { id, state: 'crashed' });
      });
      settled.set(id, done);
      return { id };
    },

    /** @param {string} id */
    cancel(id) {
      if (active === null || active.id !== id)
        throw new RunnerError('NOT_RUNNING', 'That run is not in progress.', 409);
      active.cancel('cancelled');
    },

    /** Resolves when the run has finished and its record is final. @param {string} id */
    whenDone(id) {
      return settled.get(id) ?? Promise.resolve();
    },

    /** The id of the run in progress, or null. */
    activeId() {
      return active === null ? null : active.id;
    },

    /** @param {string} id */
    get(id) {
      return store.getExecution(id);
    },

    /** @param {{ repositoryId?: string, limit?: number }} [filter] */
    list(filter) {
      return store.listExecutions(filter);
    },

    /**
     * The request that would repeat a run, as a starting point for a new preview. Values of
     * explicit variables are never stored, so they are listed for the user to supply again.
     *
     * @param {string} id
     */
    retryRequest(id) {
      const run = store.getExecution(id);
      if (run === null) throw new RunnerError('RUN_NOT_FOUND', 'No such run.', 404);
      if (run.argv.some((a) => a.includes(PLACEHOLDER)))
        throw new RunnerError(
          'RETRY_NEEDS_INPUT',
          'This command held a value that was redacted, so it cannot be repeated automatically. Enter it again.',
          409,
        );
      const names = /** @type {{ explicit?: string[], passThrough?: string[] }} */ (
        /** @type {unknown} */ (run.envNames)
      );
      const repositoryRoot = store.getRepository(run.repositoryId ?? '')?.root_path ?? '';
      const relative = path.relative(repositoryRoot, run.cwd).replaceAll('\\', '/');
      return {
        request: {
          repositoryId: run.repositoryId,
          argv: run.argv,
          cwd: relative === '' ? '.' : relative,
          deadlineSeconds: Math.round(run.deadlineMs / 1000),
          artifactPaths: run.artifactPaths,
          passThrough: names.passThrough ?? [],
          env: {},
          retryOf: run.id,
        },
        needsValues: names.explicit ?? [],
      };
    },

    /**
     * Redacted output of a run. While it is running the raw file is redacted on the way out.
     *
     * @param {string} id
     * @param {'stdout' | 'stderr'} stream
     * @param {{ tailBytes?: number }} [readOptions]
     */
    output(id, stream, readOptions = {}) {
      const run = store.getExecution(id);
      if (run === null) throw new RunnerError('RUN_NOT_FOUND', 'No such run.', 404);
      const wanted = Math.min(readOptions.tailBytes ?? limits.tailBytes, limits.tailBytes);
      const dir = runDir(id);
      const finished = path.join(dir, `${stream}.txt`);
      const raw = path.join(dir, `${stream}.raw`);
      const roots = [run.cwd];
      if (existsSync(finished)) {
        const text = readFileSync(finished, 'utf8');
        const tail = Buffer.from(text, 'utf8');
        const clipped = tail.length > wanted;
        return {
          text: clipped ? tail.subarray(tail.length - wanted).toString('utf8') : text,
          truncated: clipped,
          final: true,
          withheld: false,
        };
      }
      if (run.output?.withheld === true)
        return { text: '', truncated: false, final: true, withheld: true };
      const fd = run.state === 'running' ? openIfPresent(raw) : null;
      if (fd !== null) {
        try {
          const size = fstatSync(fd).size;
          const start = Math.max(0, size - wanted);
          const buffer = Buffer.alloc(size - start);
          readSync(fd, buffer, 0, buffer.length, start);
          let text = decode(buffer);
          // A tail can begin inside a line or a secret; start at the next line break.
          if (start > 0) text = text.slice(text.indexOf('\n') + 1);
          return {
            text: redactPersonal(redactSecrets(text, secretsOf.get(id) ?? []), { roots }),
            truncated: start > 0,
            final: false,
            withheld: false,
          };
        } finally {
          closeSync(fd);
        }
      }
      return { text: '', truncated: false, final: run.state !== 'running', withheld: false };
    },

    /** Deletes output files of runs older than the given ones. Returns the ids removed. @param {number} keep */
    pruneOutput(keep) {
      const runs = store.listExecutions({ limit: 1000 });
      const removed = [];
      for (const run of runs.slice(keep)) {
        if (run.state === 'running') continue;
        const dir = runDir(run.id);
        if (existsSync(dir) && readdirSync(dir).length > 0) {
          rmSync(dir, { recursive: true, force: true });
          removed.push(run.id);
        }
      }
      return removed;
    },
  };

  /**
   * After a run: which declared report files exist, are fresh, and were ingested.
   *
   * @param {Awaited<ReturnType<typeof plan>>} p
   * @param {number} startedMs
   * @param {boolean} didNotRun
   */
  async function collect(p, startedMs, didNotRun) {
    const declared = p.view.artifactPaths;
    if (declared.length === 0) return { status: 'not-declared', reports: [], scanId: null };
    if (didNotRun)
      return {
        status: 'none',
        reports: declared.map((d) => ({ path: d, outcome: 'command-did-not-run' })),
        scanId: null,
      };
    /** @type {Array<{ path: string, outcome: string, sha256?: string | null }>} */
    const reports = [];
    /** @type {string[]} */
    const present = [];
    for (const relative of declared) {
      const real = await resolveInside(p.repository.root_path, relative);
      const info = real === null ? null : await stat(real).catch(() => null);
      if (real === null || info === null || !info.isFile()) {
        reports.push({ path: relative, outcome: 'missing' });
      } else if (info.mtimeMs < startedMs - limits.staleSlackMs) {
        reports.push({ path: relative, outcome: 'stale' });
      } else {
        present.push(relative);
        reports.push({ path: relative, outcome: 'pending' });
      }
    }
    let scanId = null;
    if (present.length > 0) {
      const result = await engine.scan(p.repository.root_path, { declaredFiles: present });
      scanId = result.scanId;
      const summary = result.status === 'failed' ? null : store.latestScan(p.repository.id);
      for (const entry of reports) {
        if (entry.outcome !== 'pending') continue;
        const found = summary?.summary.reports.find(
          (r) => r.path === entry.path.replaceAll('\\', '/'),
        );
        entry.outcome = found === undefined ? 'not-recognised' : found.outcome;
        entry.sha256 = found?.sha256 ?? null;
      }
    }
    const good = reports.filter(
      (r) => r.outcome === 'ingested' || r.outcome === 'already-ingested',
    ).length;
    const status = good === reports.length ? 'complete' : good > 0 ? 'partial' : 'none';
    return { status, reports, scanId };
  }
}
