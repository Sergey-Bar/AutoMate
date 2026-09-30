/**
 * The one sanitiser for a caller-supplied path that is being *persisted*.
 *
 * A different rule lives in `infrastructure/artifact-store.ts` (`resolveArtifactPath`)
 * and deliberately stays separate: it throws rather than reducing, because an artifact
 * key names a file about to be written, and silently substituting a basename would
 * write the wrong artifact under a key nothing matches. Two rules, two names, one
 * reason each.
 */

import path from 'node:path';

/**
 * Reduces a caller-supplied path to something safe to persist, or to the basename
 * when the path is not one.
 *
 * The rule, in one place:
 *
 * 1. Normalise first, so `a/../../b` and `a/b/../c` are judged *after* collapsing
 *    rather than on their raw text. Judging raw text rejects paths that are harmless
 *    after normalisation — a false positive that would mangle a legitimate spec path.
 * 2. Reject absolute paths, any surviving `..`, and a NUL byte. The NUL is the one
 *    that reaches furthest: it truncates the path in every C-backed syscall, so
 *    `report.json\0/../../etc/passwd` can pass a `..` check by string inspection and
 *    resolve to a different file.
 * 3. On rejection, return the **basename** rather than the empty string. The value
 *    lands in `tests.file`, which the dashboard displays, so an empty string loses
 *    the information an operator needs, and the basename still names the file.
 * 4. Convert separators to `/` on the way out. Playwright emits forward slashes
 *    regardless of platform, so a Windows run and a Linux run of the same test
 *    produce the same string — which is what makes a `GROUP BY file` meaningful.
 */
export function safeRelativePath(rawPath: string): string {
  // **Both separators, on both platforms.** `path.sep` is `\` on Windows and `/`
  // everywhere else, so splitting on `path.sep` and rejoining with `/` converts
  // *native* separators and leaves a path that arrived with the *other* platform's
  // separator untouched. On Windows a Playwright path — `tests\login\auth.spec.ts`,
  // emitted with forward slashes regardless of platform — survived as backslashes, and
  // `safeRelativePath('C:/Windows/evil.dll')` returned the whole path rather than the
  // basename, because `C:/…` is absolute to `path.win32` but not to the `path.posix`
  // that a Linux run used to judge it.
  //
  // So the normalisation is not delegated to the platform at all: a slash is a slash
  // and a backslash is a separator, whichever one this process is running on. CI is
  // Linux, which is the only reason this was ever green — the function's third
  // documented step, *"convert separators to `/` on the way out"*, was simply untrue on
  // the platform it exists to make agree.
  const slashed = rawPath.replaceAll('\\', '/');
  const normalized = path.posix.normalize(slashed);
  // A drive letter is absolute too. `path.posix.isAbsolute('C:/Windows/evil.dll')` is
  // **false** — posix absolute means a leading `/` — so judging a Windows path with the
  // posix rule alone let `C:/Windows/evil.dll` through whole, and the value landed in
  // `tests.file` to be displayed. Both platforms' notion of absolute, checked explicitly,
  // because the function exists to make two platforms agree and neither platform's rule
  // is sufficient on its own.
  const absolute = path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
  if (absolute || normalized.includes('..') || normalized.includes('\0')) {
    return path.posix.basename(normalized);
  }
  return normalized;
}
