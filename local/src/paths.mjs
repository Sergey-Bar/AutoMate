/**
 * Path handling for report-supplied file names. Throwaway prototype code.
 *
 * A report can name any path. The rule here is the one `automate.run@2` already applies to
 * evidence URIs, extended to the places Windows reports put their paths: a stored `file` is
 * either a repository-relative POSIX path or `null`, and the original text is kept
 * separately so nothing is discarded.
 */

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replaceAll('\\', '/');
}

/**
 * @param {string} posix
 * @returns {boolean}
 */
function isAbsolute(posix) {
  return posix.startsWith('/') || /^[A-Za-z]:\//.test(posix);
}

/**
 * @param {string | undefined} raw the path exactly as the report wrote it
 * @param {string | undefined} repoRoot the repository root, when the scanner knows it
 * @returns {{ file: string | null, fileRaw: string | null, warning: string | null }}
 */
export function normaliseReportPath(raw, repoRoot) {
  if (raw === undefined || raw === '') return { file: null, fileRaw: null, warning: null };
  const posix = toPosix(raw);
  if (isAbsolute(posix)) {
    if (repoRoot !== undefined) {
      const root = toPosix(repoRoot).replace(/\/+$/, '');
      if (posix.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        const inner = normaliseReportPath(posix.slice(root.length + 1), undefined);
        return { file: inner.file, fileRaw: raw, warning: inner.warning };
      }
    }
    return { file: null, fileRaw: raw, warning: 'path-absolute' };
  }
  const segments = posix.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..') || segments.some((segment) => segment.includes('\0'))) {
    return { file: null, fileRaw: raw, warning: 'path-unsafe' };
  }
  return { file: segments.join('/'), fileRaw: raw, warning: null };
}
