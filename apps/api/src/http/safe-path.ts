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
  const normalized = path.normalize(rawPath);
  if (path.isAbsolute(normalized) || normalized.includes('..') || normalized.includes('\0')) {
    return path.basename(normalized);
  }
  return normalized.split(path.sep).join('/');
}
