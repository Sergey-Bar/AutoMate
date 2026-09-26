import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const images = ['playwright', 'k6', 'zap'];
const DIGEST = `sha256:${'7'.repeat(64)}`;

/**
 * A stand-in container runtime.
 *
 * The Docker CLI is installed on a developer machine while the daemon frequently is
 * not, so `detectContainerRuntime()` finds a binary that cannot build anything. That
 * makes it impossible to demonstrate the writeback on such a machine, and a
 * behaviour that cannot be demonstrated is a behaviour nobody knows works. The stub
 * answers the two things `oci-build.mjs` asks of a runtime — a successful build, and
 * an image ID — so the manifest writeback is exercised end to end rather than only
 * through its pure helpers.
 */
/** @param {string} directory */
function makeStubRuntime(directory) {
  const isWindows = process.platform === 'win32';
  const body = [
    '@echo off',
    'if "%1"=="--version" echo Docker version 99.0.0, build stub',
    `if "%1"=="image" echo ${DIGEST}`,
    'exit /b 0',
  ].join('\r\n');
  const name = isWindows ? 'docker.cmd' : 'docker';
  writeFileSync(
    path.join(directory, name),
    isWindows ? body : `#!/bin/sh\nprintf '%s\\n' "${DIGEST}"\nexit 0\n`,
  );
  if (!isWindows) {
    spawnSync('chmod', ['+x', path.join(directory, name)]);
  }
  return directory;
}

/** A copy of the repository containing only what `oci-build.mjs` reads. */
/** @returns {string} */
function makeFakeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'oci-build-'));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  for (const script of ['oci-build.mjs', 'container-runtime.mjs']) {
    cpSync(path.join(root, 'scripts', script), path.join(dir, 'scripts', script));
  }
  cpSync(path.join(root, 'scripts', 'lib'), path.join(dir, 'scripts', 'lib'), { recursive: true });
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
  for (const name of images) {
    mkdirSync(path.join(dir, 'runners', name), { recursive: true });
    cpSync(
      path.join(root, 'runners', name, 'manifest.json'),
      path.join(dir, 'runners', name, 'manifest.json'),
    );
  }
  return dir;
}

/** @param {string} repo @param {string} stubDir */
function runBuild(repo, stubDir) {
  return spawnSync(process.execPath, [path.join(repo, 'scripts', 'oci-build.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
    },
  });
}

test('a successful build records the image identity in each manifest', (t) => {
  const repo = makeFakeRepo();
  const stubDir = makeStubRuntime(mkdtempSync(path.join(tmpdir(), 'oci-stub-')));
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  });

  const result = runBuild(repo, stubDir);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  for (const name of images) {
    const manifest = JSON.parse(
      readFileSync(path.join(repo, 'runners', name, 'manifest.json'), 'utf8'),
    );
    // These three are exactly what `oci-verify.mjs` refuses to accept without.
    assert.equal(manifest.imageRef, `automate/${name}:local`, `${name} imageRef`);
    assert.equal(manifest.imageDigest, DIGEST, `${name} imageDigest`);
    assert.equal(manifest.buildStatus, 'built', `${name} buildStatus`);
    // And the isolation claims verify also checks must survive the writeback.
    assert.equal(manifest.user, 65532, `${name} user`);
    assert.equal(manifest.network, 'none', `${name} network`);
    assert.equal(manifest.readOnly, true, `${name} readOnly`);
  }
});

test('a runtime that reports no digest fails the build rather than leaving "unbuilt"', (t) => {
  const repo = makeFakeRepo();
  const stubDir = mkdtempSync(path.join(tmpdir(), 'oci-stub-silent-'));
  const isWindows = process.platform === 'win32';
  // Builds fine, but `image inspect` yields nothing: exactly the state that used to
  // leave every manifest claiming "unbuilt" after a successful build.
  writeFileSync(
    path.join(stubDir, isWindows ? 'docker.cmd' : 'docker'),
    isWindows
      ? ['@echo off', 'if "%1"=="--version" echo Docker version 99.0.0', 'exit /b 0'].join('\r\n')
      : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Docker version 99.0.0"; fi\nexit 0\n',
  );
  if (!isWindows) spawnSync('chmod', ['+x', path.join(stubDir, 'docker')]);
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  });

  const result = runBuild(repo, stubDir);
  assert.notEqual(result.status, 0, 'a build that cannot be recorded must not report success');
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /could not be recorded/);
  for (const name of images) {
    const manifest = JSON.parse(
      readFileSync(path.join(repo, 'runners', name, 'manifest.json'), 'utf8'),
    );
    assert.equal(
      manifest.buildStatus,
      'unbuilt',
      `${name} must not claim a build it cannot identify`,
    );
    assert.equal(manifest.imageDigest, null);
  }
});

test('a copy of the script outside a checkout refuses to write anything', (t) => {
  // The guard, exercised for real rather than asserted. A copy of this script has
  // the same write authority as the original, so it must refuse to use it unless it
  // is running from the repository whose manifests it is about to rewrite. Without
  // this check, running a copy from a scratch directory would rewrite manifests in
  // whatever relative `runners/` happened to resolve to.
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'oci-elsewhere-'));
  const stubDir = makeStubRuntime(mkdtempSync(path.join(tmpdir(), 'oci-stub-')));
  t.after(() => {
    rmSync(elsewhere, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  });

  // The whole scripts directory, so the copy loads its siblings and reaches the
  // guard rather than dying on a module resolution error.
  cpSync(path.join(root, 'scripts'), path.join(elsewhere, 'scripts'), { recursive: true });
  // A `runners/` tree to write to, which the guard must stop it reaching.
  for (const name of images) {
    mkdirSync(path.join(elsewhere, 'runners', name), { recursive: true });
    cpSync(
      path.join(root, 'runners', name, 'manifest.json'),
      path.join(elsewhere, 'runners', name, 'manifest.json'),
    );
  }

  const result = spawnSync(process.execPath, [path.join(elsewhere, 'scripts', 'oci-build.mjs')], {
    cwd: elsewhere,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env['PATH'] ?? ''}` },
  });

  assert.notEqual(result.status, 0, 'a copy outside a checkout must not proceed');
  assert.match(`${result.stdout}${result.stderr}`, /is not a repository root/);
  for (const name of images) {
    const manifest = JSON.parse(
      readFileSync(path.join(elsewhere, 'runners', name, 'manifest.json'), 'utf8'),
    );
    assert.equal(manifest.buildStatus, 'unbuilt', `${name} manifest must be untouched`);
    assert.equal(manifest.imageDigest, null);
  }
});
