/**
 * Manifest readers, and the evidence line each reading produces.
 *
 * **Regex over a manifest is not the thing decision D9 forbids.** D9 forbids a
 * regex over a *child process's stdout* being used to derive results, because
 * results must come from declared artifacts so that one parser exists. Detection
 * is reading a file the operator checked in, to decide what to *propose*; the
 * proposal is overridden by `automate.config.json` or rejected, so a miss costs
 * operator time rather than producing a wrong test result. The distinction is
 * worth the qualification, and a reader who cannot state which side of it a
 * piece of code is on should not add a third parser.
 */

/** `package.json`/`composer.json` names, as a lowercased set for a `has` check. */
export function dependencySet(
  ...groups: ReadonlyArray<Readonly<Record<string, unknown>> | null>
): Set<string> {
  const names = new Set<string>();
  for (const group of groups) {
    for (const name of Object.keys(group ?? {})) names.add(name.toLowerCase());
  }
  return names;
}

/**
 * The line in `text` that mentions `needle`, formatted as `path:line`.
 *
 * Evidence is required on every candidate and every framework signal, and an
 * evidence string that is a path alone would not let an operator check the
 * claim — so this returns the first line that mentions it, trimmed, with the
 * line number. A needle that is genuinely absent yields the bare path, which
 * reads honestly as "this file, no line to point at".
 */
export function evidenceFor(path: string, text: string | null, needle: string): string {
  if (text === null) return path;
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  if (index === -1) return path;
  return `${path}:${index + 1} ${lines[index]?.trim() ?? ''}`.trimEnd();
}

/** Every line of `text` mentioning any of `needles`, formatted for evidence. */
export function allEvidenceFor(
  path: string,
  text: string | null,
  needles: readonly string[],
  ignoreCase = false,
): string[] {
  if (text === null) return [];
  const matches = (line: string, needle: string): boolean =>
    ignoreCase ? line.toLowerCase().includes(needle.toLowerCase()) : line.includes(needle);
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => needles.some((needle) => matches(line, needle)))
    .map(({ line, index }) => `${path}:${index + 1} ${line.trim()}`.trimEnd());
}

/**
 * The body of one TOML table, up to the next `[table]` header.
 *
 * Not a TOML parser. It is a scanner for "does this file mention pytest and
 * which section mentions it", which is the only question detection asks of a
 * `pyproject.toml`, and a real parser would be a second implementation of a
 * specification nobody in this repository needs the rest of.
 */
export function tomlSection(text: string, header: string): string {
  const pattern = new RegExp(`^\\s*\\[${header.replaceAll(/[.[\]]/g, '\\$&')}\\]\\s*$`, 'm');
  const start = pattern.exec(text);
  if (!start) return '';
  const rest = text.slice(start.index + start[0].length);
  const next = /^\s*\[/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Names listed in a TOML array of strings, e.g. `dependencies = ["a", "b"]`. */
export function tomlStringArray(section: string, key: string): string[] {
  const pattern = new RegExp(`${key.replaceAll(/[.[\]]/g, '\\$&')}\\s*=\\s*\\[([^\\]]*)\\]`);
  const body = pattern.exec(section)?.[1];
  if (!body) return [];
  return [...body.matchAll(/["']([^"']+)["']/g)]
    .map((match) => distributionName(match[1] ?? ''))
    .filter((name) => name !== '');
}

/**
 * Strips a version specifier, an extras marker, and an environment marker.
 *
 * `"pytest>=7.4"`, `"pytest[dev]==7.4"` and `"pytest ; python_version>'3.8'"` all
 * name the distribution `pytest`. Reading the whole string as the name is how a
 * perfectly ordinary `pyproject.toml` reports no test framework: the string that
 * matched `pytest` in the evidence line is not the string in the dependency map.
 */
export function distributionName(requirement: string): string {
  const name = /^[A-Za-z0-9._-]+/.exec(requirement.trim())?.[0];
  return name === undefined ? '' : name.toLowerCase();
}

/** Every string array in a TOML section, whatever it is keyed by.
 *
 * `[project.optional-dependencies]` is a table of *named groups*, so the
 * dependencies live under `dev`, `test` or `docs` rather than under a
 * `dependencies` key. Reading the section with `tomlStringArray(section,
 * 'dependencies')` finds nothing there, which is how a perfectly ordinary
 * `pyproject.toml` was reported as having no test framework.
 */
export function tomlAllStringArrays(section: string): string[] {
  const names: string[] = [];
  for (const match of section.matchAll(/^[ \t]*[\w."'-]+[ \t]*=[ \t]*\[([^\]]*)\]/gm)) {
    for (const entry of match[1]?.matchAll(/["']([^"']+)["']/g) ?? []) {
      const name = entry[1] === undefined ? '' : distributionName(entry[1]);
      if (name) names.push(name);
    }
  }
  return names;
}

/** Every `<artifactId>` or `<groupId>` in an XML document, lowercased. */
export function xmlArtifactIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const match of text.matchAll(/<(?:artifactId|package)>([^<]+)<\/(?:artifactId|package)>/g)) {
    const value = match[1]?.trim().toLowerCase();
    if (value) ids.add(value);
  }
  return ids;
}

/**
 * The dependency names a Ruby manifest declares.
 *
 * **Dogfooded against `rack/rack`, which found the bug this comment is about.**
 *
 * The pattern was `/^\s*(?:gem|spec\.add_)\s*[('"]\s*['"]?(...)/`, which requires a
 * quote *immediately* after `spec.add_`. Rack declares its test framework as
 * `s.add_development_dependency 'minitest', "> 5"` — the word `development` sits
 * between the prefix and the name — so **every `add_*_dependency` in a gemspec was
 * invisible**, and a repository that ships minitest reported no test framework at
 * all. The score takes `presence` from whether a suite completed a run, so that is
 * not a cosmetic miss: it reads as *this repository has no tests*.
 *
 * Matched as two explicit patterns rather than one loose prefix, because
 * `add_development_dependency` and `add_runtime_dependency` are different edges and
 * only the first is test tooling.
 */
export function rubyDependencyNames(text: string): Set<string> {
  const names = new Set<string>();
  const patterns = [
    // `gem 'rspec', '~> 3.13'` and `gem "rack"`, at the head of a line.
    /^\s*gem\s*[('"]\s*['"]?([a-z0-9_/-]+)/gim,
    // `s.add_development_dependency 'minitest'`, `spec.add_runtime_dependency 'x'`.
    /\badd_(?:development_|runtime_)?dependency\s*[('"]\s*['"]?([a-z0-9_/-]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.toLowerCase();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Parses JSON without throwing.
 *
 * A manifest is customer input. `JSON.parse` on a truncated `package.json`
 * raises, and a detector that raises has no way to say "I could not read this",
 * so the exception would surface as a 500 from an operator adding a repository.
 */
export function readJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A `Record` field of `source`, or `null` when it is absent or the wrong shape. */
export function objectField(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A `string[]` field of `source`, lowercased, skipping any entry that is not a string. */
export function stringArrayField(source: Record<string, unknown> | null, key: string): string[] {
  const value = source?.[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.toLowerCase());
}
