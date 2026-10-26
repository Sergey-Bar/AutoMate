import { describe, expect, it } from 'vitest';
import { parseLineCoverage, LINE_COVERAGE_FORMATS } from './line-coverage.js';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';

const bytes = (text: string) => new TextEncoder().encode(text);

function refusal(run: () => unknown): HealthReportError {
  try {
    run();
  } catch (error) {
    if (error instanceof HealthReportError) return error;
    throw error;
  }
  throw new Error('expected a HealthReportError');
}

describe('lcov', () => {
  it('reads DA records into sorted executable and covered lines, merging repeated files', () => {
    const report = parseLineCoverage(
      'lcov',
      bytes(
        [
          'TN:',
          'SF:.\\src\\b.ts',
          'DA:3,0',
          'DA:1,4,checksum',
          'DA:2,0',
          'LF:3',
          'end_of_record',
          'SF:src/a.ts',
          'DA:5,1',
          'end_of_record',
          'SF:src/b.ts',
          'DA:2,1',
          'DA:9,0',
          'end_of_record',
          '',
        ].join('\r\n'),
      ),
    );
    expect(report.files).toEqual([
      { path: 'src/a.ts', executable: [5], covered: [5] },
      { path: 'src/b.ts', executable: [1, 2, 3, 9], covered: [1, 2] },
    ]);
  });

  it.each([
    ['no SF record', 'TN:\nend_of_record\n'],
    ['a DA before any SF', 'DA:1,1\nSF:a.ts\n'],
    ['a DA with no hit count', 'SF:a.ts\nDA:1\n'],
    ['a line number that is not positive', 'SF:a.ts\nDA:0,1\n'],
    ['a hit count that is not a number', 'SF:a.ts\nDA:1,x\n'],
    ['an empty SF path', 'SF:\nDA:1,1\n'],
  ])('refuses %s', (_label, text) => {
    expect(refusal(() => parseLineCoverage('lcov', bytes(text))).code).toBe('malformed');
  });
});

describe('cobertura', () => {
  it('reads every <line> of every <class>, decoding entities in the filename', () => {
    const xml = `<?xml version="1.0"?>
      <coverage line-rate="0.5"><sources><source>/ci/repo</source></sources>
        <packages><package name="p"><classes>
          <class name="A" filename="src/a&amp;b.py">
            <methods><method name="m"><lines><line number="2" hits="1"/></lines></method></methods>
            <lines>
              <line hits="0" number="3" branch="false"/>
              <line number="2" hits="1"/>
              <line number="1" hits="7"></line>
            </lines>
          </class>
          <class name="B" filename="src\\b.py"><lines/></class>
          <class name="NoFile"><lines><line number="1" hits="1"/></lines></class>
          <class name="C" filename="src/c.py">
            <lines><line number="4"/><line number="5" hits="2"/></lines>
          </class>
        </classes></package></packages>
      </coverage>`;
    expect(parseLineCoverage('cobertura', bytes(xml)).files).toEqual([
      { path: 'src/a&b.py', executable: [1, 2, 3], covered: [1, 2] },
      { path: 'src/b.py', executable: [], covered: [] },
      { path: 'src/c.py', executable: [5], covered: [5] },
    ]);
  });

  it('decodes every XML entity in a path', () => {
    const xml = `<coverage><packages><class filename="&lt;&gt;&quot;&apos;&#47;&#x2F;x.py"><line number="1" hits="0"/></class></packages></coverage>`;
    expect(parseLineCoverage('cobertura', bytes(xml)).files[0]?.path).toBe(`<>"'//x.py`);
  });

  it('refuses a document that is not a cobertura report', () => {
    expect(refusal(() => parseLineCoverage('cobertura', bytes('<report/>'))).code).toBe(
      'malformed',
    );
  });

  it('refuses a line whose number is not a positive integer', () => {
    const xml = `<coverage><packages><class filename="a.py"><line number="x" hits="1"/></class></packages></coverage>`;
    expect(refusal(() => parseLineCoverage('cobertura', bytes(xml))).message).toContain(
      'line number',
    );
  });
});

describe('jacoco-xml', () => {
  it('reads sourcefile line records under their package directory', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE report>
      <report name="r">
        <package name="com/example">
          <class name="com/example/Service" sourcefilename="Service.java">
            <counter type="LINE" missed="1" covered="1"/>
          </class>
          <sourcefile name="Service.java">
            <line nr="12" mi="0" ci="3" mb="0" cb="0"/>
            <line nr="10" mi="2" ci="0"/>
            <counter type="LINE" missed="1" covered="1"/>
          </sourcefile>
          <sourcefile name="Empty.java"></sourcefile>
        </package>
        <package name="">
          <sourcefile name="Root.java"><line nr="1" mi="0" ci="1"/></sourcefile>
        </package>
      </report>`;
    expect(parseLineCoverage('jacoco-xml', bytes(xml)).files).toEqual([
      { path: 'Root.java', executable: [1], covered: [1] },
      { path: 'com/example/Empty.java', executable: [], covered: [] },
      { path: 'com/example/Service.java', executable: [10, 12], covered: [12] },
    ]);
  });

  it('refuses a document that is not a JaCoCo report, and a line with no number', () => {
    expect(refusal(() => parseLineCoverage('jacoco-xml', bytes('<coverage/>'))).code).toBe(
      'malformed',
    );
    const xml = `<report><package name="p"><sourcefile name="A.java"><line mi="0" ci="1"/></sourcefile></package></report>`;
    expect(refusal(() => parseLineCoverage('jacoco-xml', bytes(xml))).code).toBe('malformed');
  });

  it('skips a sourcefile with no name rather than inventing a path', () => {
    const xml = `<report><package name="p"><sourcefile><line nr="1" ci="1"/></sourcefile></package></report>`;
    expect(parseLineCoverage('jacoco-xml', bytes(xml)).files).toEqual([]);
  });

  it('reads a package with no name as the root, and a line with no ci as not covered', () => {
    const xml = `<report><package><sourcefile name="A.java"><line nr="2"/></sourcefile></package></report>`;
    expect(parseLineCoverage('jacoco-xml', bytes(xml)).files).toEqual([
      { path: 'A.java', executable: [2], covered: [] },
    ]);
  });
});

describe('go-coverprofile', () => {
  it('expands each block over its line range, a line covered when any block covering it ran', () => {
    const profile = [
      'mode: atomic',
      'example.com/m/pkg/a.go:3.10,5.2 2 0',
      'example.com/m/pkg/a.go:5.2,6.3 1 4',
      'example.com/m/pkg/b.go:1.1,1.9 1 0',
      '',
    ].join('\n');
    expect(parseLineCoverage('go-coverprofile', bytes(profile)).files).toEqual([
      { path: 'example.com/m/pkg/a.go', executable: [3, 4, 5, 6], covered: [5, 6] },
      { path: 'example.com/m/pkg/b.go', executable: [1], covered: [] },
    ]);
  });

  it.each([
    ['no mode line', 'a.go:1.1,2.2 1 1\n'],
    ['an empty document', '\n\n'],
    ['a block it cannot read', 'mode: set\na.go 1 1\n'],
    ['a block that ends before it starts', 'mode: set\na.go:5.1,3.1 1 1\n'],
  ])('refuses %s', (_label, text) => {
    expect(refusal(() => parseLineCoverage('go-coverprofile', bytes(text))).code).toBe('malformed');
  });
});

describe('every format', () => {
  it('lists the four formats it reads', () => {
    expect(LINE_COVERAGE_FORMATS).toEqual(['lcov', 'cobertura', 'jacoco-xml', 'go-coverprofile']);
  });

  it.each(LINE_COVERAGE_FORMATS)('%s refuses an oversize report before reading it', (format) => {
    const error = refusal(() =>
      parseLineCoverage(format, new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)),
    );
    expect(error.code).toBe('too_large');
  });

  it('refuses a format it does not know', () => {
    const error = refusal(() => parseLineCoverage('simplecov' as 'lcov', bytes('')));
    expect(error.code).toBe('unsupported');
  });
});
