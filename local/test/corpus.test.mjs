import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import test from 'node:test';
import { ingest, sha256 } from '../src/ingest.mjs';
import { CONTRACT_STATUS_MAP, OUTCOMES, OUTCOME_CLASS, reconcile } from '../src/model.mjs';
import {
  FILES_DIR,
  REPO_ROOT,
  LOCAL_ROOT,
  bytesFor,
  loadGoldens,
  loadManifest,
  optionsFor,
  project,
} from './support.mjs';

const manifest = loadManifest();
const goldens = loadGoldens();

test('every fixture matches its hand-authored golden', () => {
  assert.ok(manifest.length >= 40, 'the corpus was loaded');
  for (const entry of manifest) {
    const golden = goldens[entry.id];
    assert.ok(golden !== undefined, `${entry.id} has no golden`);
    const { result } = ingest(bytesFor(entry), optionsFor(entry));
    assert.deepEqual(project(result, golden), golden, `fixture ${entry.id}`);
  }
});

test('goldens and manifest agree in both directions, and no file is orphaned', () => {
  const ids = manifest.map((entry) => entry.id).sort();
  assert.deepEqual(Object.keys(goldens).sort(), ids);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const referenced = new Set(
    manifest.flatMap((entry) => [entry.file, ...(entry.companions ?? [])]).filter(Boolean),
  );
  const onDisk = readdirSync(FILES_DIR);
  assert.deepEqual(
    onDisk.filter((name) => !referenced.has(name)),
    [],
    'orphaned fixture files',
  );
  assert.deepEqual(
    [...referenced].filter((name) => !onDisk.includes(name)),
    [],
    'missing files',
  );
});

test('an unknown, missing or incomplete outcome is never reported as a pass', () => {
  // The invariant the whole product rests on, asserted over every fixture rather than the
  // ones a person remembered to write a case for.
  for (const entry of manifest) {
    const { result } = ingest(bytesFor(entry), optionsFor(entry));
    if (result.kind !== 'run') continue;
    if (result.runStatus === 'passed') {
      assert.equal(result.completeness, 'complete', `${entry.id}: passed on an incomplete report`);
      assert.ok(
        result.tests.every((t) => OUTCOME_CLASS[t.outcome] === 'product'),
        `${entry.id}: passed with a non-product outcome`,
      );
      assert.ok(
        result.tests.some((t) => t.outcome === 'passed'),
        `${entry.id}: passed with no passing test`,
      );
    }
    for (const t of result.tests) {
      if (t.attempts.some((a) => a.outcome === 'unknown')) {
        assert.notEqual(t.outcome, 'passed', `${entry.id}: ${t.name} hid an unknown attempt`);
      }
    }
  }
});

test('per-run counts reconcile: product + indeterminate + non-product = total', () => {
  for (const entry of manifest) {
    const { result } = ingest(bytesFor(entry), optionsFor(entry));
    if (result.kind !== 'run') continue;
    assert.deepEqual(reconcile(result), [], entry.id);
  }
});

test('raw bytes are untouched by ingestion and the digest is of the original bytes', () => {
  for (const entry of manifest) {
    if (entry.file === undefined) continue;
    const bytes = new Uint8Array(readFileSync(path.join(FILES_DIR, entry.file)));
    const before = sha256(bytes);
    const { artifact } = ingest(bytes, optionsFor(entry));
    assert.equal(artifact.sha256, before, entry.id);
    assert.equal(artifact.byteSize, bytes.byteLength, entry.id);
    assert.equal(sha256(bytes), before, `${entry.id}: ingestion changed its input`);
  }
});

test('a zero-test report is a result, not an error', () => {
  for (const id of ['junit-zero-tests', 'playwright-zero']) {
    const entry = manifest.find((candidate) => candidate.id === id);
    assert.ok(entry);
    const { result } = ingest(bytesFor(entry), optionsFor(entry));
    assert.equal(result.kind, 'run');
    assert.equal(result.runStatus, 'noTests');
  }
});

test('hostile XML is bounded, and nothing it names is expanded, read or fetched', () => {
  for (const id of ['xml-billion-laughs', 'xml-external-entity']) {
    const entry = manifest.find((candidate) => candidate.id === id);
    assert.ok(entry);
    const started = performance.now();
    const { result } = ingest(bytesFor(entry), optionsFor(entry));
    const elapsed = performance.now() - started;
    const serialised = JSON.stringify(result);
    assert.ok(elapsed < 1000, `${id} took ${String(elapsed)} ms`);
    assert.ok(serialised.length < 20_000, `${id} produced ${String(serialised.length)} bytes`);
    assert.ok(!serialised.includes('lollollol'), `${id}: an entity was expanded`);
    assert.ok(!serialised.includes('SENTINEL_FILE_CONTENT'), `${id}: an external file was read`);
    assert.ok(result.warnings.includes('doctype-ignored'));
    assert.ok(result.warnings.includes('entity-undefined'));
  }
});

test('the XML reader has no way to touch the filesystem or the network', () => {
  // A structural check on the prototype's own imports. It shows this module cannot read a
  // file or open a socket; it says nothing about how `saxes` behaves.
  const forbidden =
    /from\s+['"](?:node:)?(?:fs|fs\/promises|net|http|https|dns|child_process|dgram|tls)['"]/;
  for (const name of ['xml.mjs', 'junit.mjs', 'paths.mjs']) {
    const source = readFileSync(path.join(LOCAL_ROOT, 'src', name), 'utf8');
    assert.ok(!forbidden.test(source), `${name} imports a filesystem or network module`);
  }
});

test('the status mapping covers every status of the server contract, derived from source', () => {
  const source = readFileSync(
    path.join(REPO_ROOT, 'packages/shared-contracts/src/schemas/canonical-reporting.ts'),
    'utf8',
  );
  const block = /const StatusSchema = z\.enum\(\[([\s\S]*?)\]\);/.exec(source);
  assert.ok(block, 'could not find StatusSchema in canonical-reporting.ts');
  const code = (block[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const contractStatuses = [...code.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1] ?? '');
  assert.ok(contractStatuses.length >= 10, `read only ${String(contractStatuses.length)} statuses`);
  assert.deepEqual(Object.keys(CONTRACT_STATUS_MAP).sort(), [...contractStatuses].sort());
  for (const mapped of Object.values(CONTRACT_STATUS_MAP)) {
    assert.ok(OUTCOMES.includes(mapped.outcome), `${mapped.outcome} is not a local outcome`);
  }
});

test('every manifest entry carries complete provenance', () => {
  for (const entry of manifest) {
    for (const field of ['origin', 'licence', 'generation', 'date']) {
      assert.ok(entry.provenance[field], `${entry.id} lacks provenance.${field}`);
    }
    if (entry.kind === 'real-tool-output') {
      assert.ok(entry.provenance.tool && entry.provenance.toolVersion, `${entry.id}: tool/version`);
      assert.ok(entry.provenance.postProcessing, `${entry.id}: post-processing is recorded`);
    }
  }
});
