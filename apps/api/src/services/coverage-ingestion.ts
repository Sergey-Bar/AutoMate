import type { CoverageFormat } from '@automate/reporter';

/**
 * The coverage join — the one that turns the score's `depth` component from
 * `unknown` into a measurement.
 *
 * ## What was missing, and why it is the highest-value gap left
 *
 * The profile has declared `coverageGlobs` since `packages/projects` was
 * written, `packages/reporter` has parsed six coverage formats since before that,
 * and `apps/api` never once read a coverage document. `assemble` accepted a
 * `coverageDocuments` parameter and every caller passed `[]`, so `depth` was
 * `unknown` on every cell of every screen — a fifth of the score answering "no
 * idea" while the product printed a total beside it.
 *
 * ## The three rules, and why each is a rule
 *
 * 1. **A glob is matched against the artifact's declared filename**, and the
 *    pattern's own `format` is how the bytes are parsed. A caller declaring two
 *    formats gets both parsed; a caller declaring one gets the other ignored.
 *    There is no format sniffing, because a lcov and a cobertura can share an
 *    extension and a guessed format is a misread number — the one thing this
 *    product cannot afford.
 * 2. **`uncoveredModules` is derived from the report, not from a source scan.**
 *    A coverage document that names a file with executable lines and none covered
 *    *is* the list of uncovered modules. Reading a second source to build it
 *    would be a second authority that can disagree with the first, and the
 *    score's own definition ("modules that had runnable source and no test
 *    exercising them") is exactly what the report holds.
 * 3. **Nothing is invented for a module the report never names.** A file absent
 *    from the report is unknown, not uncovered — and `depth` stays `unknown`
 *    there rather than being reported as a hole nobody measured.
 */

/** One artifact the run uploaded, as the descriptor the store returns it. */
export interface CoverageArtifact {
  /** The declared filename, which is what a glob matches against. */
  path: string;
  /** The bytes, or `null` when the store does not have them. */
  bytes: Uint8Array | null;
}

/** One declared coverage glob, as the profile carries it. */
export interface DeclaredCoverageGlob {
  glob: string;
  format: CoverageFormat;
}

/**
 * A glob, matched against a filename.
 *
 * Written here rather than taken from a dependency because the workspace has no
 * glob library and this is the whole of what the coverage globs need: `**` across
 * separators, `*` within a segment, `?` for one character. Anything beyond that
 * is a pattern the profile's own schema does not promise.
 *
 * **The translation is total, so it always returns.** Every regex metacharacter
 * is escaped to its literal form before it reaches the pattern, which means the
 * result cannot fail to compile — the earlier `try`/`catch` around `new RegExp`
 * was defending against an input the translator already made safe, and a branch
 * no input can reach is a branch no test can cover. A pathologically long glob
 * still fails, and that failure is loud: the caller's declared pattern is a bug,
 * not a file to skip.
 */
export function compileGlob(glob: string): (path: string) => boolean {
  // Translate in one pass rather than with a chain of replaces, because a chain
  // re-reads its own output: `**/` escaped once becomes `.*` and then a second
  // pass escaping `.` would escape the `.` it just produced.
  let out = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === '*' && next === '*') {
      // `**/` and a trailing `**` both cross separators; a bare `**` in the
      // middle is the same thing.
      if (glob[index + 2] === '/') {
        out += '(?:.*/)?';
        index += 2;
      } else {
        out += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    // Everything else is literal, and the regex-escape is per character so a `.`
    // in a filename cannot become "any character" and match a file nobody named.
    out += /[.+^${}()|[\]\\]/u.test(char ?? '') ? `\\${char}` : (char ?? '');
  }
  const pattern = new RegExp(`^${out}$`, 'u');
  return (path: string): boolean => pattern.test(path);
}

/** The artifacts a set of declared globs selects, in the order they are declared. */
export function selectCoverageArtifacts(
  artifacts: readonly CoverageArtifact[],
  globs: readonly DeclaredCoverageGlob[],
): Array<{ glob: DeclaredCoverageGlob; artifact: CoverageArtifact }> {
  const found: Array<{ glob: DeclaredCoverageGlob; artifact: CoverageArtifact }> = [];
  for (const glob of globs) {
    const matcher = compileGlob(glob.glob);
    for (const artifact of artifacts) {
      if (!matcher(artifact.path)) continue;
      // The first artifact a glob matches wins: a repository with two lcov
      // reports under one glob has both, and picking one arbitrarily is a
      // silent choice. The first is the deterministic one, and it is stated.
      found.push({ glob, artifact });
      break;
    }
  }
  return found;
}

/** One uncovered module, read out of a report rather than out of a source scan. */
export interface UncoveredModule {
  /** Repo-relative POSIX path, as the report names it. */
  path: string;
  /** Executable lines the report counted, which is why it is a module at all. */
  totalLines: number;
}

/**
 * The modules a coverage report says have executable lines and none covered.
 *
 * **A file the report never names is unknown, not uncovered.** The distinction is
 * the whole difference between a reportable hole and an absent measurement, and
 * the score keeps `depth: unknown` for the files it cannot see rather than
 * counting them as holes.
 */
export function uncoveredModulesFrom(
  files: Array<{ path: string; coveredLines: number; totalLines: number }>,
  limit = 50,
): UncoveredModule[] {
  return (
    files
      .filter((file) => file.totalLines > 0 && file.coveredLines === 0)
      .map((file) => ({ path: file.path, totalLines: file.totalLines }))
      // The largest first: a four-hundred-line module nobody exercises is a more
      // useful answer than a two-line one.
      .sort((left, right) => right.totalLines - left.totalLines)
      .slice(0, limit)
  );
}
