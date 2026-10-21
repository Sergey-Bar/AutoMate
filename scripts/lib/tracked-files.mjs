import { execFileSync } from 'node:child_process';

/**
 * Every tracked or untracked-but-not-ignored path, **or the reason there is none**.
 *
 * A gate that reads the index must be able to tell "git listed nothing" from "git did not
 * run", and an empty list is neither: a repository always tracks something. So both a
 * failure and an empty answer come back as a `problem` the caller reports as a failed
 * check, never as a clean one.
 *
 * @param {() => string} [run] returns `git ls-files` output; injectable for the tests
 * @returns {{ files: string[], problem: string | null }}
 */
export function trackedFiles(run) {
  const list =
    run ??
    (() =>
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }));
  let output;
  try {
    output = list();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { files: [], problem: `git ls-files could not run: ${detail}` };
  }
  const files = output.split(/\r?\n/).filter(Boolean);
  if (files.length === 0) {
    return { files, problem: 'git ls-files listed no files, so there is nothing to check' };
  }
  return { files, problem: null };
}
