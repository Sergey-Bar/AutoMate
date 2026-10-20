import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanRepository } from '../src/detect.mjs';
import { LOCAL_ROOT } from './support.mjs';

/**
 * Builds a repository in a temporary directory from a map of relative paths to contents.
 *
 * @param {Record<string, string>} files
 */
function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-repo-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
}

/**
 * A digest of every file's path, bytes and modification time, to prove a scan wrote nothing.
 *
 * @param {string} root
 */
function treeDigest(root) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const info = statSync(full);
      hash.update(`${path.relative(root, full)}|${String(info.mtimeMs)}|${String(info.size)}|`);
      if (info.isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

const JUNIT = '<testsuite name="a" tests="1"><testcase classname="a" name="x"/></testsuite>';

test('a scan leaves the repository exactly as it found it', async () => {
  const repo = repository({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest run' },
      devDependencies: { vitest: '^1' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'vitest.config.ts': 'export default {};\n',
    'reports/junit.xml': JUNIT,
  });
  try {
    const before = treeDigest(repo.root);
    const result = await scanRepository(repo.root);
    assert.equal(result.status, 'complete');
    assert.equal(treeDigest(repo.root), before);
  } finally {
    repo.cleanup();
  }
});

test('the scanner module imports nothing that can write, rename or delete', () => {
  const source = readFileSync(path.join(LOCAL_ROOT, 'src', 'detect.mjs'), 'utf8');
  const imported = /import\s*\{([^}]*)\}\s*from\s*'node:fs(?:\/promises)?'/g;
  const names = [...source.matchAll(imported)].flatMap((match) =>
    (match[1] ?? '').split(',').map((name) => name.trim()),
  );
  assert.ok(names.length > 0, 'the check found the fs imports');
  for (const name of names) {
    assert.ok(
      !/write|append|mkdir|rm|unlink|rename|copy|chmod|chown|symlink|link|truncate|utimes/i.test(
        name,
      ),
      `detect.mjs imports ${name}`,
    );
  }
  assert.ok(!/child_process|node:net|node:http/.test(source), 'and runs and connects to nothing');
});

test('nothing is executed: a scan starts no process', async () => {
  // The module has no import of a process API; the walk is the only thing it does.
  const source = readFileSync(path.join(LOCAL_ROOT, 'src', 'detect.mjs'), 'utf8');
  assert.ok(!/spawn|exec(?:File)?\(|fork\(/.test(source));
});

test('every finding carries evidence', async () => {
  const repo = repository({
    'package.json': JSON.stringify({ devDependencies: { jest: '^29', '@playwright/test': '^1' } }),
    'jest.config.js': 'module.exports = {};\n',
    'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n',
    'pom.xml': '<project><dependencies><dependency>junit</dependency></dependencies></project>\n',
    'go.mod': 'module x\n',
    'x_test.go': 'package x\n',
    '.github/workflows/ci.yml': 'name: ci\n',
    // Names no test tool, so the Maven detector has nothing to cite and must say nothing.
    'plain/pom.xml': '<project/>\n',
  });
  try {
    const { projects } = await scanRepository(repo.root);
    const findings = projects.flatMap((project) => project.findings);
    assert.ok(findings.length >= 6, `only ${String(findings.length)} findings`);
    for (const f of findings) assert.ok(f.evidence.length > 0, f.subject);
    const subjects = findings.map((f) => f.subject);
    for (const expected of [
      'test-tool:jest',
      'test-tool:playwright',
      'test-tool:pytest',
      'test-tool:junit',
      'test-tool:go-test',
      'ci-configuration',
    ]) {
      assert.ok(subjects.includes(expected), `missing ${expected}`);
    }
  } finally {
    repo.cleanup();
  }
});

test('a tool with its configuration file is more confident than one without', async () => {
  const repo = repository({
    'a/package.json': JSON.stringify({ devDependencies: { jest: '^29' } }),
    'a/jest.config.js': '',
    'b/package.json': JSON.stringify({ devDependencies: { jest: '^29' } }),
  });
  try {
    const { projects } = await scanRepository(repo.root);
    const confidence = (dir) =>
      projects
        .find((p) => p.relativePath === dir)
        ?.findings.find((f) => f.subject === 'test-tool:jest')?.confidence ?? 0;
    assert.ok(confidence('a') > confidence('b'));
    const lacking = projects
      .find((p) => p.relativePath === 'b')
      ?.findings.find((f) => f.subject === 'test-tool:jest');
    assert.deepEqual(lacking?.limits, ['no configuration file found']);
  } finally {
    repo.cleanup();
  }
});

test('a monorepo yields one project per manifest, and dependency directories are not entered', async () => {
  const repo = repository({
    'package.json': JSON.stringify({ name: 'root' }),
    'apps/web/package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
    'services/api/pom.xml': '<project>junit</project>\n',
    'node_modules/dep/package.json': JSON.stringify({ devDependencies: { jest: '1' } }),
  });
  try {
    const { projects } = await scanRepository(repo.root);
    const paths = projects.map((p) => p.relativePath);
    assert.deepEqual(
      paths.filter((p) => p !== '.'),
      ['apps/web', 'services/api'],
    );
    assert.ok(!paths.some((p) => p.includes('node_modules')));
  } finally {
    repo.cleanup();
  }
});

test('reports are found in build output only where a report location is named', async () => {
  const repo = repository({
    'target/surefire-reports/TEST-a.xml': JUNIT,
    'target/classes/results.xml': JUNIT,
    'coverage/lcov.info': 'TN:\nSF:a.js\nDA:1,1\nend_of_record\n',
    'test-results/playwright.json': '{"suites":[]}',
    'node_modules/pkg/junit.xml': JUNIT,
    'docs/notes-report.xml': '<html><body>not a report</body></html>',
  });
  try {
    const { reports } = await scanRepository(repo.root);
    const byPath = new Map(reports.map((r) => [r.relativePath, r.format]));
    assert.equal(byPath.get('target/surefire-reports/TEST-a.xml'), 'junit-xml');
    assert.equal(byPath.get('coverage/lcov.info'), 'lcov');
    assert.equal(byPath.get('test-results/playwright.json'), 'playwright-json');
    assert.equal(byPath.has('target/classes/results.xml'), false, 'build output is not walked');
    assert.equal(byPath.has('node_modules/pkg/junit.xml'), false);
    assert.equal(
      byPath.get('docs/notes-report.xml'),
      null,
      'a report-shaped file that is not one is listed as unrecognised',
    );
  } finally {
    repo.cleanup();
  }
});

test('a link back to a parent directory does not make the scan loop', async () => {
  const repo = repository({ 'a/package.json': JSON.stringify({ devDependencies: { jest: '1' } }) });
  try {
    // A junction needs no privilege on Windows; on other platforms this is a plain symlink.
    symlinkSync(repo.root, path.join(repo.root, 'a', 'loop'), 'junction');
    const result = await scanRepository(repo.root);
    assert.equal(result.status, 'complete');
    // Some platforms report a junction as a link and some do not; either way it is not followed.
    assert.ok(
      result.notes.some((note) => ['link-not-followed', 'already-visited'].includes(note.reason)),
    );
    assert.equal(result.projects.filter((p) => p.relativePath === 'a').length, 1);
  } finally {
    repo.cleanup();
  }
});

test('a link that leaves the repository is not entered', async () => {
  const repo = repository({ 'package.json': '{}' });
  const outside = repository({
    'package.json': JSON.stringify({ devDependencies: { jest: '1' } }),
  });
  try {
    symlinkSync(outside.root, path.join(repo.root, 'escape'), 'junction');
    const result = await scanRepository(repo.root);
    assert.ok(!result.projects.some((p) => p.relativePath.startsWith('escape')));
    assert.ok(
      result.notes.some((note) =>
        ['link-not-followed', 'outside-repository'].includes(note.reason),
      ),
    );
  } finally {
    repo.cleanup();
    outside.cleanup();
  }
});

test('a limit that is hit makes the scan partial and says which', async () => {
  const files = {};
  for (let index = 0; index < 30; index += 1) files[`f${String(index).padStart(2, '0')}.txt`] = 'x';
  const repo = repository(files);
  try {
    const files_ = await scanRepository(repo.root, { limits: { maxFiles: 10 } });
    assert.equal(files_.status, 'partial');
    assert.deepEqual(files_.limitsHit, ['maxFiles']);
    const deep = await scanRepository(repo.root, { limits: { maxEntriesPerDirectory: 5 } });
    assert.deepEqual(deep.limitsHit, ['maxEntriesPerDirectory']);
  } finally {
    repo.cleanup();
  }
});

test('a scan can be cancelled and reports it', async () => {
  const files = {};
  for (let index = 0; index < 50; index += 1) files[`d${String(index)}/f.txt`] = 'x';
  const repo = repository(files);
  try {
    const controller = new globalThis.AbortController();
    controller.abort();
    const result = await scanRepository(repo.root, { signal: controller.signal });
    assert.equal(result.status, 'cancelled');
  } finally {
    repo.cleanup();
  }
});

test('a path that is not a repository is refused with a reason', async () => {
  const repo = repository({ 'file.txt': 'x' });
  try {
    assert.deepEqual((await scanRepository(path.join(repo.root, 'file.txt'))).status, 'failed');
    assert.equal((await scanRepository(path.join(repo.root, 'missing'))).reason, 'not-a-directory');
    assert.equal((await scanRepository(path.parse(repo.root).root)).reason, 'filesystem-root');
  } finally {
    repo.cleanup();
  }
});

test('an unrecognised repository reports nothing recognised, not an empty success', async () => {
  const repo = repository({ 'README.md': '# hi\n', 'src/main.c': 'int main(){}\n' });
  try {
    const result = await scanRepository(repo.root);
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.projects, []);
    assert.deepEqual(result.reports, []);
  } finally {
    repo.cleanup();
  }
});

test('a custom report directory outside the repository is allowed and marked external', async () => {
  const repo = repository({ 'package.json': '{}' });
  const external = repository({ 'out/junit.xml': JUNIT });
  try {
    const result = await scanRepository(repo.root, {
      extraReportDirs: [path.join(external.root, 'out')],
    });
    const found = result.reports.find((r) => r.external);
    assert.equal(found?.format, 'junit-xml');
  } finally {
    repo.cleanup();
    external.cleanup();
  }
});

test('the scan is deterministic', async () => {
  const repo = repository({
    'b/package.json': JSON.stringify({ devDependencies: { jest: '1' } }),
    'a/package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
    'reports/z.xml': JUNIT,
    'reports/a.xml': JUNIT,
  });
  try {
    const first = await scanRepository(repo.root);
    const second = await scanRepository(repo.root);
    assert.deepEqual(first, second);
  } finally {
    repo.cleanup();
  }
});
