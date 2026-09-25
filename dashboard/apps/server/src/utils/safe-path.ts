import * as path from 'path';

/**
 * Resolve a user-supplied relative path against a base directory and verify
 * the result stays within the base.  Prevents path-traversal attacks.
 *
 * @throws {Error} if the resolved path escapes `base`.
 */
export function safePath(base: string, userPath: string): string {
  const normalizedBase = path.resolve(base);
  const resolved = path.resolve(normalizedBase, userPath);

  // On Windows `path.resolve` normalises separators, so startsWith is safe
  // after resolving both sides.  The `+ path.sep` prevents prefix collisions
  // (e.g. /foo/bar vs /foo/bar-baz).
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}
