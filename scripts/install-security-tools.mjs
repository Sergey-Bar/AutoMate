/**
 * Installs the scanners that `pnpm security:static` requires, at pinned versions.
 *
 * `static-analysis.mjs` treats a missing scanner as a failure, which is the correct
 * default: an unrun security scan is not a pass. That makes the install part of the
 * gate, so it lives here, next to the gate, rather than in a workflow that could fail
 * for reasons the gate never sees.
 *
 * Both tools come from their official distribution channels and both are verified:
 * gitleaks against the checksum published in its own release, semgrep through PyPI,
 * which resolves and verifies the wheel's hash. A version pin without a checksum
 * would leave the supply chain unpinned in the only sense that matters.
 *
 * The checksum above is for the Linux x64 tarball, which is what CI runs. On another
 * platform the digest is computed and reported but not compared, because this
 * repository records exactly one. That is stated in the output rather than left for
 * the reader to discover: a verified install and an unverified one must not look the
 * same.
 *
 * Idempotent: a tool already on PATH at the pinned version is left alone.
 *
 * Run from the repository root: `pnpm security:install`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GITLEAKS_SHA256,
  GITLEAKS_VERSION,
  gitleaksAssetName,
  SEMGREP_REQUIREMENT,
  SEMGREP_VERSION,
} from './tool-versions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A copy of `tool-versions.mjs` elsewhere on disk must not be able to make this
 * script install something.
 *
 * The installer's only authority is the version list it imports, and that list is a
 * constant in a source file. If the file were read from a directory chosen by
 * `$HOME` or a temporary path, running a copy of this script would install whatever
 * those said. Requiring the repository's own copy means the authority is the
 * repository, which is the thing a reviewer reads.
 */
if (!existsSync(path.join(root, 'pnpm-workspace.yaml'))) {
  console.error(
    `Refusing to install: ${root} is not the repository root ` +
      '(no pnpm-workspace.yaml). Run this from a checkout, via `pnpm security:install`.',
  );
  process.exit(1);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd: cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

/** @param {string} binary */
function have(binary) {
  const probe = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return !probe.error && probe.status === 0;
}

/** @param {string} binary */
function versionOf(binary) {
  const probe = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return (probe.stdout ?? '').trim();
}

const failures = [];

// --- gitleaks -----------------------------------------------------------------

const asset = gitleaksAssetName(process.platform, process.arch);
if (asset === null) {
  failures.push(
    `gitleaks ${GITLEAKS_VERSION} publishes no build for ${process.platform}/${process.arch}. ` +
      'Install it yourself and re-run, or run this step on Linux x64.',
  );
} else if (have('gitleaks') && versionOf('gitleaks').includes(GITLEAKS_VERSION)) {
  console.log(`gitleaks ${GITLEAKS_VERSION} is already installed.`);
} else {
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}`;
  const workdir = mkdtempSync(path.join(tmpdir(), 'gitleaks-'));
  try {
    console.log(`Installing gitleaks ${GITLEAKS_VERSION} from ${url}`);
    const download = run('curl', ['-fsSL', '--retry', '3', '-o', asset, url], workdir);
    if (download.status !== 0) {
      failures.push(`could not download ${url}`);
    } else {
      const archive = path.join(workdir, asset);
      const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
      const verified = process.platform === 'linux' && process.arch === 'x64';
      if (verified && digest !== GITLEAKS_SHA256) {
        failures.push(
          `gitleaks checksum mismatch for ${asset}.\n` +
            `  expected ${GITLEAKS_SHA256}\n  actual   ${digest}\n` +
            'Refusing to install. Either the release asset was replaced or the ' +
            'checksum in scripts/tool-versions.mjs is wrong.',
        );
      } else {
        if (!verified) {
          console.warn(
            `gitleaks: installed from ${url} and hashed ${digest}, but this repository ` +
              'records a checksum only for linux/x64, so this install is NOT ' +
              'checksum-verified. The digest is printed so it can be compared by hand.',
          );
        }
        if (asset.endsWith('.zip')) {
          run('unzip', ['-o', asset, '-d', workdir], workdir);
        } else {
          run('tar', ['-xzf', asset], workdir);
        }
        const binary = path.join(
          workdir,
          process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks',
        );
        const installDir = path.join(root, 'node_modules', '.bin');
        const destination = path.join(
          installDir,
          process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks',
        );
        if (run('mkdir', ['-p', installDir]).status !== 0) {
          failures.push(`could not create ${installDir}`);
        } else if (run('cp', [binary, destination]).status !== 0) {
          failures.push(`could not install gitleaks to ${destination}`);
        } else if (process.platform !== 'win32') {
          run('chmod', ['+x', destination]);
        } else {
          console.log(`Installed gitleaks to ${destination}`);
        }
      }
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

// --- semgrep ------------------------------------------------------------------

if (have('semgrep') && versionOf('semgrep').includes(SEMGREP_VERSION)) {
  console.log(`semgrep ${SEMGREP_VERSION} is already installed.`);
} else {
  // `python3 -m pip install --user` rather than `pipx`, because it needs no
  // additional bootstrap on the runner image and fails loudly if pip is missing.
  console.log(`Installing ${SEMGREP_REQUIREMENT} from PyPI`);
  const installed = run('python3', [
    '-m',
    'pip',
    'install',
    '--user',
    '--disable-pip-version-check',
    SEMGREP_REQUIREMENT,
  ]);
  if (installed.status !== 0) {
    failures.push(
      `could not install ${SEMGREP_REQUIREMENT}. On a Debian-based image that usually ` +
        'means an externally-managed environment; install pipx or a virtualenv, or ' +
        'pre-install semgrep on the runner image.',
    );
  } else {
    // `--user` puts the console script somewhere the runner's PATH may not include,
    // so report where rather than leaving the gate to fail on a missing binary.
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    const userBin = path.join(home, '.local', 'bin');
    console.log(
      `Installed semgrep. If \`semgrep --version\` is not on PATH, add ${userBin} to it.`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `\nSecurity tool install failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`,
  );
  process.exit(1);
}
console.log('Security tools installed.');
