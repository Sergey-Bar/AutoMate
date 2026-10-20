import assert from 'node:assert/strict';
import test from 'node:test';
import { TextEncoder } from 'node:util';
import { parseCobertura } from '../src/cobertura.mjs';
import { detectFormat, ingest } from '../src/ingest.mjs';

// These documents are written by hand from the published Cobertura DTD. No coverage tool
// produced them, so what these tests show is that the parser follows the format as written,
// not that it reads every tool's output.
const encode = (text) => new TextEncoder().encode(text);

const FULL = `<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage line-rate="0.6" branch-rate="0.5" lines-covered="3" lines-valid="5" branches-covered="1" branches-valid="2" version="1" timestamp="1700000000">
  <sources><source>/home/someone/project</source></sources>
  <packages>
    <package name="app" line-rate="0.6" branch-rate="0.5" complexity="0">
      <classes>
        <class name="app.Calc" filename="src/calc.py" line-rate="0.75" branch-rate="0.5" complexity="0">
          <methods>
            <method name="add" signature="()V" line-rate="1.0" branch-rate="1.0"><lines><line number="1" hits="2"/></lines></method>
            <method name="sub" signature="()V" line-rate="0.0" branch-rate="1.0"><lines><line number="4" hits="0"/></lines></method>
          </methods>
          <lines>
            <line number="1" hits="2"/>
            <line number="2" hits="1" branch="true" condition-coverage="50% (1/2)"/>
            <line number="3" hits="1"/>
            <line number="4" hits="0"/>
          </lines>
        </class>
        <class name="app.Other" filename="src/other.py" line-rate="0" branch-rate="1">
          <methods/>
          <lines><line number="1" hits="0"/></lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;

test('a Cobertura report becomes the same coverage snapshot lcov produces', () => {
  const result = parseCobertura(encode(FULL));
  assert.equal(result.kind, 'coverage');
  assert.equal(result.format, 'cobertura-xml');
  assert.equal(result.completeness, 'complete');
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['src/calc.py', 'src/other.py'],
  );
  const [calc, other] = result.files;
  assert.deepEqual(calc.lines, { found: 4, hit: 3 });
  assert.deepEqual(
    calc.functions,
    { found: 2, hit: 1 },
    'a method counts as hit when any of its lines ran',
  );
  assert.deepEqual(calc.branches, { found: 2, hit: 1 });
  assert.deepEqual(other.lines, { found: 1, hit: 0 });
  assert.equal(other.functions, null, 'a class with no methods has no function figure, not 0 of 0');
  assert.equal(other.branches, null);
  assert.deepEqual(result.totals.lines, { found: 5, hit: 3, percent: 60 });
  assert.deepEqual(result.totals.functions, { found: 2, hit: 1, percent: 50 });
  assert.ok(result.warnings.includes('metric-not-reported-by-all-files'));
  assert.ok(result.warnings.includes('doctype-ignored'));
});

test('the declared totals are only a cross-check, and sources paths are not kept', () => {
  const lying = FULL.replace('lines-valid="5"', 'lines-valid="50"');
  const result = parseCobertura(encode(lying));
  assert.ok(result.warnings.includes('cobertura-count-mismatch'));
  assert.equal(result.totals.lines.found, 5, 'the detail wins');
  assert.ok(
    !JSON.stringify(result).includes('/home/someone'),
    'the machine-specific path is dropped',
  );
});

test('classes that share a file are merged by line number, not double counted', () => {
  const doc = `<coverage line-rate="1" lines-valid="2" lines-covered="2"><packages><package name="p"><classes>
    <class name="A" filename="a.java"><lines><line number="1" hits="1"/><line number="2" hits="1"/></lines></class>
    <class name="A$Inner" filename="a.java"><lines><line number="2" hits="3"/></lines></class>
  </classes></package></packages></coverage>`;
  const result = parseCobertura(encode(doc));
  assert.equal(result.files.length, 1);
  assert.deepEqual(result.files[0].lines, { found: 2, hit: 2 });
  assert.deepEqual(result.totals.lines, { found: 2, hit: 2, percent: 100 });
});

test('nothing found is null, never a percentage', () => {
  const empty = parseCobertura(
    encode('<coverage line-rate="0" lines-valid="0" lines-covered="0"><packages/></coverage>'),
  );
  assert.equal(empty.totals.lines.percent, null);
  assert.equal(empty.totals.functions, null);
  assert.ok(empty.warnings.includes('cobertura-no-classes'));
});

test('damaged input is handled as a result, not a crash', () => {
  assert.equal(parseCobertura(encode('<testsuite name="x"/>')).rejection, 'not-cobertura');
  assert.equal(
    parseCobertura(encode('<coverage><packages/></coverage>')).rejection,
    'not-cobertura',
    'no rates and no counts is not Cobertura',
  );
  assert.equal(parseCobertura(encode('')).rejection, 'empty-input');
  assert.equal(parseCobertura(encode('plain text')).rejection, 'not-xml');
  const truncated = parseCobertura(encode(FULL.slice(0, FULL.indexOf('<class name="app.Other"'))));
  assert.equal(truncated.kind, 'coverage');
  assert.equal(
    truncated.completeness,
    'unknown',
    'a cut-off document is never presented as complete',
  );
  const badLine = parseCobertura(
    encode(
      '<coverage line-rate="1"><packages><package><classes><class filename="a"><lines><line number="x" hits="1"/></lines></class></classes></package></packages></coverage>',
    ),
  );
  assert.ok(badLine.warnings.includes('cobertura-bad-line'));
  assert.equal(badLine.completeness, 'unknown');
  const noFile = parseCobertura(
    encode(
      '<coverage line-rate="1"><packages><package><classes><class name="A"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>',
    ),
  );
  assert.ok(noFile.warnings.includes('cobertura-class-without-filename'));
  assert.equal(noFile.files.length, 0);
});

test('hostile XML gets the same treatment as for JUnit: no entity expansion, hard limits', () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE coverage [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><coverage line-rate="1"><packages><package><classes><class filename="&b;"><lines/></class></classes></package></packages></coverage>`;
  const result = parseCobertura(encode(bomb));
  assert.ok(JSON.stringify(result).length < 2000, 'nothing was expanded');
  assert.ok(result.kind === 'rejected' || result.completeness !== 'complete');
  const deep = '<coverage line-rate="1">' + '<a>'.repeat(300) + '</a>'.repeat(300) + '</coverage>';
  assert.equal(parseCobertura(encode(deep)).kind, 'rejected');
});

test('the content decides the format: a Cobertura document is not mistaken for JUnit, and the reverse', () => {
  assert.equal(detectFormat(encode(FULL)), 'cobertura-xml');
  assert.equal(
    detectFormat(encode('<?xml version="1.0"?><!-- <coverage> --><testsuite name="x"/>')),
    'junit-xml',
    'a comment does not change the root',
  );
  assert.equal(detectFormat(encode('<testsuites><coverage/></testsuites>')), 'junit-xml');
  assert.equal(detectFormat(encode('<coverage line-rate="1"/>')), 'cobertura-xml');
  assert.equal(ingest(encode(FULL)).result.format, 'cobertura-xml');
  assert.equal(ingest(encode(FULL)).result.kind, 'coverage');
});
