import { describe, expect, it } from 'vitest';

import {
  allEvidenceFor,
  distributionName,
  evidenceFor,
  objectField,
  readJson,
  rubyDependencyNames,
  stringArrayField,
  tomlAllStringArrays,
  tomlSection,
  tomlStringArray,
  xmlArtifactIds,
} from './manifest.js';

describe('evidenceFor', () => {
  it('cites the first line that mentions the needle, trimmed, with its 1-based number', () => {
    const text = 'name = "x"\r\n  pytest = "7"  \r\npytest again';
    expect(evidenceFor('pyproject.toml', text, 'pytest')).toBe('pyproject.toml:2 pytest = "7"');
  });

  it('cites the bare path when the file is absent', () => {
    expect(evidenceFor('go.mod', null, 'testify')).toBe('go.mod');
  });

  it('cites the bare path when the needle is not in the file', () => {
    expect(evidenceFor('go.mod', 'module x', 'testify')).toBe('go.mod');
  });

  it('does not leave trailing whitespace when the matching line is blank after trimming', () => {
    expect(evidenceFor('f', '   ', ' ')).toBe('f:1');
  });
});

describe('allEvidenceFor', () => {
  it('returns nothing for an absent file', () => {
    expect(allEvidenceFor('f', null, ['a'])).toEqual([]);
  });

  it('returns one citation per matching line, for any of the needles', () => {
    expect(allEvidenceFor('f', 'a\nb\n  c  \nab', ['a', 'c'])).toEqual([
      'f:1 a',
      'f:3 c',
      'f:4 ab',
    ]);
  });

  it('is case-sensitive by default and case-insensitive on request', () => {
    expect(allEvidenceFor('f', 'PyTest', ['pytest'])).toEqual([]);
    expect(allEvidenceFor('f', 'PyTest', ['pytest'], true)).toEqual(['f:1 PyTest']);
    expect(allEvidenceFor('f', 'pytest', ['PYTEST'], true)).toEqual(['f:1 pytest']);
  });
});

describe('tomlSection', () => {
  const text = ['[project]', 'name = "x"', '', '[tool.pytest.ini_options]', 'addopts = "-q"'].join(
    '\n',
  );

  it('returns the body up to the next table header', () => {
    expect(tomlSection(text, 'project')).toBe('\nname = "x"\n');
  });

  it('returns the rest of the file for the last table', () => {
    expect(tomlSection(text, 'tool.pytest.ini_options')).toBe('\naddopts = "-q"');
  });

  it('treats the dots in a header as literal dots, not wildcards', () => {
    expect(tomlSection('[toolXpytest]\na = 1', 'tool.pytest')).toBe('');
  });

  it('returns an empty string for a table that is not there', () => {
    expect(tomlSection(text, 'dependencies')).toBe('');
  });

  it('finds a header with surrounding whitespace', () => {
    expect(tomlSection('  [a]  \nx = 1', 'a')).toBe('\nx = 1');
  });
});

describe('tomlStringArray', () => {
  it('reads names out of a multi-line array and strips specifiers', () => {
    const section = 'dependencies = [\n  "pytest>=7.4",\n  \'Requests[socks]==2\',\n]';
    expect(tomlStringArray(section, 'dependencies')).toEqual(['pytest', 'requests']);
  });

  it('returns nothing when the key is absent or the array empty', () => {
    expect(tomlStringArray('other = ["a"]', 'dependencies')).toEqual([]);
    expect(tomlStringArray('dependencies = []', 'dependencies')).toEqual([]);
  });

  it('skips an entry that is not a name', () => {
    expect(tomlStringArray('d = [">=1", "  ", "ok"]', 'd')).toEqual(['ok']);
  });
});

describe('distributionName', () => {
  it.each([
    ['pytest>=7.4', 'pytest'],
    ['pytest[dev]==7.4', 'pytest'],
    ["pytest ; python_version>'3.8'", 'pytest'],
    ['  Flask  ', 'flask'],
    ['my.pkg_name-2', 'my.pkg_name-2'],
    ['>=1.0', ''],
    ['', ''],
  ])('%j names %j', (requirement, expected) => {
    expect(distributionName(requirement)).toBe(expected);
  });
});

describe('tomlAllStringArrays', () => {
  it('reads every group of an optional-dependencies table whatever its key', () => {
    const section = [
      'dev = ["pytest>=7", "ruff"]',
      '"docs-extra" = [\'sphinx\']',
      'name = "not an array"',
      '  test = ["hypothesis"]',
    ].join('\n');
    expect(tomlAllStringArrays(section)).toEqual(['pytest', 'ruff', 'sphinx', 'hypothesis']);
  });

  it('does not end an array at the bracket of an extras marker', () => {
    expect(tomlAllStringArrays('dev = ["pytest[dev]>=7", "ruff"]')).toEqual(['pytest', 'ruff']);
  });

  it('drops entries that name nothing and returns an empty list for no arrays', () => {
    expect(tomlAllStringArrays('a = [">=1"]')).toEqual([]);
    expect(tomlAllStringArrays('')).toEqual([]);
  });
});

describe('xmlArtifactIds', () => {
  it('collects artifactId and package values, lowercased and trimmed', () => {
    const xml =
      '<artifactId> JUnit-Jupiter </artifactId><package>Microsoft.NET.Test.Sdk</package><artifactId>   </artifactId>';
    expect([...xmlArtifactIds(xml)].sort()).toEqual(['junit-jupiter', 'microsoft.net.test.sdk']);
  });

  it('is empty for a document with neither element', () => {
    expect(xmlArtifactIds('<project></project>').size).toBe(0);
  });
});

describe('rubyDependencyNames', () => {
  it('reads Gemfile gems in every quoting style', () => {
    const names = rubyDependencyNames(
      `gem 'rspec', '~> 3.13'\n  gem "Rack"\ngem('capybara')\n# gem 'commented'`,
    );
    expect([...names].sort()).toEqual(['capybara', 'rack', 'rspec']);
  });

  it('reads gemspec development and runtime dependencies', () => {
    const names = rubyDependencyNames(
      `s.add_development_dependency 'minitest', "> 5"\nspec.add_runtime_dependency 'zeitwerk'\ns.add_dependency "plain"`,
    );
    expect([...names].sort()).toEqual(['minitest', 'plain', 'zeitwerk']);
  });

  it('is empty when nothing is declared', () => {
    expect(rubyDependencyNames('source "https://rubygems.org"').size).toBe(0);
  });
});

describe('readJson', () => {
  it('returns null rather than throwing for truncated input', () => {
    expect(readJson('{"scripts": {')).toBeNull();
  });

  it('returns null for absent text and for JSON that is not an object', () => {
    expect(readJson(null)).toBeNull();
    expect(readJson('[1,2]')).toBeNull();
    expect(readJson('"s"')).toBeNull();
    expect(readJson('null')).toBeNull();
  });

  it('returns the object otherwise', () => {
    expect(readJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('objectField', () => {
  it('returns a nested object and refuses every other shape', () => {
    const source = { o: { a: 1 }, arr: [1], n: null, s: 'x' };
    expect(objectField(source, 'o')).toEqual({ a: 1 });
    expect(objectField(source, 'arr')).toBeNull();
    expect(objectField(source, 'n')).toBeNull();
    expect(objectField(source, 's')).toBeNull();
    expect(objectField(source, 'missing')).toBeNull();
    expect(objectField(null, 'o')).toBeNull();
  });
});

describe('stringArrayField', () => {
  it('lowercases strings and skips non-strings', () => {
    expect(stringArrayField({ k: ['A', 1, null, 'b'] }, 'k')).toEqual(['a', 'b']);
  });

  it('returns an empty list for a missing field, a non-array or no source', () => {
    expect(stringArrayField({ k: 'a' }, 'k')).toEqual([]);
    expect(stringArrayField({}, 'k')).toEqual([]);
    expect(stringArrayField(null, 'k')).toEqual([]);
  });
});
