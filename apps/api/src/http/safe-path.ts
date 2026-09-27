/**
 * safe-path.ts — the one sanitiser for a caller-supplied path.
 *
 * `routes/reporter.ts` and `services/reporter-persistence.ts` each had their own
 * copy, and the two were **byte-identical** apart from the function name. Nothing
 * tied them together, so a fix to either was invisible to the other, and the two
 * sit on different sides of the route boundary — the route sanitises a `test.file`
 * from an upload, and the persistence layer sanitises the same field again on the
 * way to disk. A divergence would have been a path that passed one check and failed
 * the other, which is the kind of thing that only shows up on Windows, or with a
 * Unicode separator, or after a refactor.
 *
 * A third, *different* rule lives in `infrastructure/artifact-store.ts`
 * (`resolveArtifactPath`) and deliberately stays separate: it **throws** rather
 * than reducing, because an artifact key names a file about to be written and
 * silently substituting a basename would write the wrong artifact under a key
 * nothing matches. Two rules, two names, one reason each — the mistake being avoided
 * is one function pretending to be both.
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
  const normalized = path.normalize(rawPath);
  if (path.isAbsolute(normalized) || normalized.includes('..') || normalized.includes('\0')) {
    return path.basename(normalized);
  }
  return normalized.split(path.sep).join('/');
}
