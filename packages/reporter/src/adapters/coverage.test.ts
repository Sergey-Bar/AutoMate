import { describe, expect, it } from 'vitest';

import {
  COVERAGE_ADAPTERS,
  parseCoverage,
  surfaceCoverage,
  type CoverageReport,
} from './coverage.js';

/**
 * Coverage is **not** a test result.
 *
 * These adapters deliberately do not implement `ProducerAdapter`. A cobertura
 * document offered to a result adapter parses a percentage as if it were a suite,
 * and the run then reports a passing test that does not exist — the exact
 * confusion `packages/projects` records when it splits `artifactGlobs` from
 * `coverageGlobs`.
 *
 * Each fixture below is the smallest real document of its format. They are inline
 * rather than on disk because a coverage corpus is read by the assertion beside it,
 * and a file in `test-fixtures/` is one `git clean` away from being the only
 * evidence.
 */

const LCOV = `TN:
SF:src/auth/login.ts
DA:1,1
DA:2,1
DA:3,0
DA:4,1
LF:4
LH:3
end_of_record
SF:src/auth/token.ts
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record
`;

const COBERTURA = `<?xml version="1.0"?>
<coverage line-rate="0.5" branch-rate="0" version="1.9">
  <packages><package name="src" line-rate="0.5">
    <classes><class filename="src/auth/login.ts" line-rate="0.75">
      <lines>
        <line number="1" hits="1"/><line number="2" hits="1"/><line number="3" hits="0"/><line number="4" hits="1"/>
      </lines>
    </class></packages>
  </packages>
</coverage>
`;

const JACOCO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<report name="svc">
  <package name="com/example">
    <class name="com/example/Service" sourcefilename="Service.java">
      <counter type="INSTRUCTION" missed="0" covered="10"/>
      <counter type="LINE" missed="4" covered="6"/>
    </class>
  </package>
</report>
`;

const GO_PROFILE = `mode: set
github.com/example/svc/auth/login.go:10.13,12.2 1 1
github.com/example/svc/auth/login.go:14.20,16.1 1 0
github.com/example/svc/auth/token.go:5.1,7.1 1 1
`;

const SIMPLECOV = `{
  "meta": { "timestamp": 1790000000 },
  "coverage": {
    "/repo/src/auth/login.rb": [1, 1, 0, 1, null],
    "/repo/src/auth/token.rb": [1, 0, 1]
  }
}
`;

const ENC = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('every format the detector promises has an adapter', () => {
  it('covers all six coverage formats in packages/projects', () => {
    // The detector's `CoverageFormat` list and this registry are two claims about
    // what can be ingested. If the detector promises a format with no adapter, a
    // project is offered a command whose output nothing can read.
    expect(Object.keys(COVERAGE_ADAPTERS).sort()).toEqual([
      'cobertura',
      'go-coverprofile',
      'jacoco-xml',
      'lcov',
      'llvm-cov',
      'simplecov',
    ]);
  });
});

describe('lcov, which Node, Python and coverlet all write', () => {
  const report = (): CoverageReport => parseCoverage('lcov', ENC(LCOV));

  it('reads covered and total lines per file', () => {
    const parsed = report();
    expect(parsed.files).toEqual([
      { path: 'src/auth/login.ts', coveredLines: 3, totalLines: 4 },
      { path: 'src/auth/token.ts', coveredLines: 1, totalLines: 2 },
    ]);
  });

  it('reports the covered fraction over every file', () => {
    // 4 covered of 6 total = 0.6667, not the average of the two per-file
    // fractions (0.75 and 0.5, which would be 0.625). Averaging ratios lets a
    // 2-line file outvote a 400-line one, which is how coverage goes up while
    // nothing is covered.
    expect(report().coveredFraction).toBeCloseTo(4 / 6, 6);
  });

  it('reads a file with no executable line as zero, not as absent', () => {
    // `SF:` with no `DA:` lines: the file was loaded and has nothing executable.
    // It must appear, with zeros — dropping it would silently remove a file the
    // scanner looked at, and a file that is *known* to be empty is information.
    const parsed = parseCoverage('lcov', ENC('SF:src/empty.ts\nLF:0\nLH:0\nend_of_record\n'));
    expect(parsed.files).toEqual([{ path: 'src/empty.ts', coveredLines: 0, totalLines: 0 }]);
    expect(parsed.coveredFraction).toBeNull();
  });

  it('reads a DA line with zero hits as uncovered, not as absent', () => {
    const parsed = parseCoverage('lcov', ENC('SF:src/a.ts\nDA:1,0\nend_of_record\n'));
    expect(parsed.files).toEqual([{ path: 'src/a.ts', coveredLines: 0, totalLines: 1 }]);
    expect(parsed.coveredFraction).toBe(0);
  });

  it('prefers the DA lines over a declared LF/LH that disagrees', () => {
    // A generator writing both, one stale, must not decide the number. The DA
    // lines are the measurement; LF/LH is the generator's own summary of them.
    const parsed = parseCoverage(
      'lcov',
      ENC('SF:src/a.ts\nDA:1,1\nDA:2,0\nLF:99\nLH:99\nend_of_record\n'),
    );
    expect(parsed.files[0]).toEqual({ path: 'src/a.ts', coveredLines: 1, totalLines: 2 });
  });

  it('reports no fraction for a document with no records', () => {
    expect(parseCoverage('lcov', ENC('TN:\nend_of_record\n')).coveredFraction).toBeNull();
  });
});

describe('cobertura, which Python and .NET both write', () => {
  it('reads each class file and its line hits', () => {
    const parsed = parseCoverage('cobertura', ENC(COBERTURA));
    expect(parsed.files).toEqual([{ path: 'src/auth/login.ts', coveredLines: 3, totalLines: 4 }]);
  });

  it('ignores the document line-rate and counts the lines itself', () => {
    // `line-rate="0.5"` on a document whose only file is at 0.75. Trusting the
    // declared rate would report a number no file supports.
    expect(parseCoverage('cobertura', ENC(COBERTURA)).coveredFraction).toBeCloseTo(0.75, 6);
  });

  it('refuses a document with no packages element', () => {
    expect(() => parseCoverage('cobertura', ENC('<coverage/>'))).toThrow(/cobertura/i);
  });
});

describe('jacoco, which Java writes as XML', () => {
  it('reads the LINE counter rather than the INSTRUCTION counter', () => {
    // JaCoCo emits counters for INSTRUCTION, BRANCH, LINE, COMPLEXITY and
    // METHOD. Taking the first one silently reports 10/10 covered for a class
    // with four missed lines, because INSTRUCTION and LINE differ.
    const parsed = parseCoverage('jacoco-xml', ENC(JACOCO));
    expect(parsed.files).toEqual([
      { path: 'com/example/Service.java', coveredLines: 6, totalLines: 10 },
    ]);
  });

  it('reports no fraction when the report carries no LINE counter at all', () => {
    const withoutLine = JACOCO.replace(/<counter type="LINE"[^/]*\/>/u, '');
    expect(parseCoverage('jacoco-xml', ENC(withoutLine)).coveredFraction).toBeNull();
  });
});

describe('go, which writes a profile format that is neither', () => {
  it('counts the profile blocks, hit or not', () => {
    const parsed = parseCoverage('go-coverprofile', ENC(GO_PROFILE));
    expect(parsed.files).toEqual([
      { path: 'github.com/example/svc/auth/login.go', coveredLines: 1, totalLines: 2 },
      { path: 'github.com/example/svc/auth/token.go', coveredLines: 1, totalLines: 1 },
    ]);
  });

  it('ignores the mode line', () => {
    expect(parseCoverage('go-coverprofile', ENC(GO_PROFILE)).files).toHaveLength(2);
  });

  it('reports no fraction for an empty profile', () => {
    expect(parseCoverage('go-coverprofile', ENC('mode: atomic\n')).coveredFraction).toBeNull();
  });
});

describe('simplecov, which Ruby writes as a per-line array', () => {
  it('counts a line array, skipping the nulls that mean not executable', () => {
    // `[1, 1, 0, 1, null]` — the `null` is a line with no relevant coverage, not
    // an uncovered line. Counting it as uncovered understates every Ruby file,
    // and Ruby files are full of them.
    const parsed = parseCoverage('simplecov', ENC(SIMPLECOV));
    expect(parsed.files).toEqual([
      { path: 'src/auth/login.rb', coveredLines: 3, totalLines: 4 },
      { path: 'src/auth/token.rb', coveredLines: 2, totalLines: 3 },
    ]);
  });

  it('strips the absolute prefix a coverage report carries but a repo does not', () => {
    expect(parseCoverage('simplecov', ENC(SIMPLECOV)).files[0]?.path).toBe('src/auth/login.rb');
  });
});

describe('llvm-cov, which Rust writes as a JSON export', () => {
  const LLVM = JSON.stringify({
    data: [
      {
        files: [
          { filename: '/repo/src/lib.rs', summary: { lines: { count: 120, covered: 96 } } },
          { filename: '/repo/src/main.rs', summary: { lines: { count: 40, covered: 40 } } },
        ],
      },
    ],
  });

  it('reads the per-file line summary', () => {
    const parsed = parseCoverage('llvm-cov', ENC(LLVM));
    expect(parsed.files).toEqual([
      { path: '/repo/src/lib.rs', coveredLines: 96, totalLines: 120 },
      { path: '/repo/src/main.rs', coveredLines: 40, totalLines: 40 },
    ]);
  });

  it('keeps the absolute path, because there is no repository root to strip it with', () => {
    // lcov, cobertura and JaCoCo all write repo-relative paths. llvm-cov writes
    // whatever the compiler was given, which is usually absolute. Inventing a
    // `stripRepoPrefix` for this format — as SimpleCov needed — would be a guess
    // about where the customer's checkout is, and a wrong guess moves files into
    // the wrong surface.
    expect(parseCoverage('llvm-cov', ENC(LLVM)).files[0]?.path).toContain('/repo/src/lib.rs');
  });

  it('divides covered over total rather than averaging the two ratios', () => {
    // 136 of 160, not the mean of 0.8 and 1.0.
    expect(parseCoverage('llvm-cov', ENC(LLVM)).coveredFraction).toBeCloseTo(136 / 160, 6);
  });

  it('reports nothing measured for an export with no files', () => {
    expect(parseCoverage('llvm-cov', ENC(JSON.stringify({ data: [] }))).coveredFraction).toBeNull();
  });

  it('refuses a document that is not an llvm-cov export', () => {
    expect(() => parseCoverage('llvm-cov', ENC('{} not json'))).toThrow(/llvm-cov/i);
    expect(() => parseCoverage('llvm-cov', ENC('[]'))).toThrow(/llvm-cov/i);
  });
});

describe('a surface is a classification, and coverage cannot make it', () => {
  it('splits the report by an injected classifier rather than guessing', () => {
    // `src/api/**` is the backend and `src/ui/**` is the frontend. **No coverage
    // format states either**, so an adapter that assigned surfaces itself would be
    // inventing a fact about the customer's architecture.
    const report = parseCoverage('lcov', ENC(LCOV));
    const classified = surfaceCoverage(report, (path) =>
      path.startsWith('src/auth/') ? 'backend' : 'platform',
    );
    expect(classified.backend).toBeCloseTo(4 / 6, 6);
    expect(classified.frontend).toBeNull();
    expect(classified.platform).toBeNull();
  });

  it('leaves a surface null rather than zero when nothing was classified into it', () => {
    // `null` is "not measured". `0` is "measured and uncovered", and the score
    // treats them differently: the first is an absent measurement, the second is
    // a cell that genuinely has no covered surface.
    const report = parseCoverage('lcov', ENC(LCOV));
    expect(surfaceCoverage(report, () => 'backend').frontend).toBeNull();
  });

  it('reports every surface as null for a report that measured nothing', () => {
    const empty = parseCoverage('lcov', ENC('TN:\nend_of_record\n'));
    expect(surfaceCoverage(empty, () => 'backend')).toEqual({
      backend: null,
      frontend: null,
      platform: null,
    });
  });
});
