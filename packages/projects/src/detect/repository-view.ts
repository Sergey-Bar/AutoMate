import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * The only I/O the detector is allowed to do, behind one port.
 *
 * Two reasons it is a port rather than a direct `node:fs` call. A detector that
 * reads the filesystem itself can only be tested by writing fixture directories
 * that a `git clean` can remove and that jscpd counts as source; and the W0 exit
 * criterion is one fixture repository *per ecosystem*, which is eight
 * directories whose only contents are a manifest and a lockfile. Reading through
 * a literal map of file contents makes that fixture the test data itself, which
 * is also readable when the assertion fails.
 */
export interface RepositoryView {
  /** Every file path in the repository, repo-relative with POSIX separators. */
  paths(): Promise<readonly string[]>;
  /** File contents, or `null` when the repository does not contain it. */
  read(relativePath: string): Promise<string | null>;
}

/** Walks `root` and reads from disk. The only implementation product code uses. */
export function fileSystemView(
  root: string,
  ignore: readonly string[] = DEFAULT_IGNORED,
): RepositoryView {
  const absolute = path.resolve(root);
  const rootLength = absolute.length + 1;
  return {
    async paths() {
      const found: string[] = [];
      const stack = [absolute];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (ignore.includes(entry.name) || entry.name.startsWith('.')) continue;
            stack.push(full);
            continue;
          }
          found.push(full.slice(rootLength).split(path.sep).join('/'));
        }
      }
      // Sorted so two runs over the same tree produce the same proposal, which
      // is what lets a profile be compared rather than merely re-read.
      return found.sort();
    },
    async read(relativePath) {
      try {
        return await readFile(path.join(absolute, relativePath), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

/**
 * Directories the walk does not descend into.
 *
 * Not a `.gitignore` implementation and not one either: these are the four
 * directories whose contents are never a manifest and are always large —
 * `node_modules` above all, where a walk of a real Node repository would read
 * tens of thousands of files to find one `package.json`.
 */
export const DEFAULT_IGNORED: readonly string[] = [
  'node_modules',
  'vendor',
  'target',
  'build',
  'dist',
  'venv',
  '__pycache__',
] as const;

/** A `RepositoryView` over a literal map, for a fixture held in the test file. */
export function literalView(files: Readonly<Record<string, string>>): RepositoryView {
  return {
    async paths() {
      return Object.keys(files).sort();
    },
    async read(relativePath) {
      return files[relativePath] ?? null;
    },
  };
}
