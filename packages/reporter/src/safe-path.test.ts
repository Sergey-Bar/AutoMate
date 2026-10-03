import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeRelativePath } from './safe-path.js';

/**
 * The one rule for a caller-supplied path.
 *
 * `routes/reporter.ts` and `services/reporter-persistence.ts` each carried a
 * byte-identical copy, on opposite sides of the route boundary, sanitising the same
 * `tests.file` field. This test is the single description of what both now do.
 *
 * The value lands in `tests.file`, which the dashboard groups by, so the assertions
 * are about the *string* a run on Linux and a run on Windows must agree on — not
 * merely about not escaping a directory.
 */

describe('safeRelativePath', () => {
  it('passes a plain relative path through', () => {
    expect(safeRelativePath('tests/login.spec.ts')).toBe('tests/login.spec.ts');
  });

  it('converts separators to forward slashes, so two platforms agree', () => {
    // Playwright emits forward slashes whatever the platform, so a Windows run and a
    // Linux run of the same test must produce the same string or a `GROUP BY file`
    // counts one test twice.
    const windows = safeRelativePath('tests\\login\\auth.spec.ts');
    expect(windows).toBe('tests/login/auth.spec.ts');
    expect(windows).toBe(safeRelativePath('tests/login/auth.spec.ts'));
  });

  it('collapses a harmless interior dot segment instead of treating it as traversal', () => {
    // Normalising *before* judging is what makes this safe. A raw `..` check rejects
    // `tests/./login.spec.ts`-style paths that are entirely legitimate, and mangles
    // the spec path an operator then sees in the dashboard.
    expect(safeRelativePath('tests/./login.spec.ts')).toBe('tests/login.spec.ts');
    expect(safeRelativePath('tests/nested/../login.spec.ts')).toBe('tests/login.spec.ts');
  });

  it('reduces a traversal to the basename, so the file is still named', () => {
    // The basename rather than `''`: the value is displayed, and an operator looking
    // at a suspicious upload needs to see which file claimed to be involved.
    expect(safeRelativePath('../../etc/passwd')).toBe('passwd');
    expect(safeRelativePath('tests/../../../secret.spec.ts')).toBe('secret.spec.ts');
  });

  it('reduces an absolute path to its basename', () => {
    expect(safeRelativePath('/etc/passwd')).toBe('passwd');
    // A Windows absolute path, on a Windows host. `path.normalize` keeps the drive
    // letter and `path.isAbsolute` sees it, so the same rule applies.
    const windowsAbsolute = path.join(path.sep === '/' ? 'C:' : 'C:', 'Windows', 'evil.dll');
    expect(safeRelativePath(windowsAbsolute)).toBe('evil.dll');
  });

  it('rejects a NUL byte, which is the one that survives a string check', () => {
    // `report.json\0/../../etc/passwd` contains `..`, so a `..` check catches it —
    // but `report.json\0/../secret` reaches a C-backed syscall as a path truncated
    // at the NUL, which resolves somewhere else entirely. A test that only looked
    // for `..` would pass this input.
    expect(safeRelativePath('report.json\0/../../etc/passwd')).toBe('passwd');
    expect(safeRelativePath('\0/etc/passwd')).toBe('passwd');
  });

  it('is idempotent, so sanitising twice changes nothing', () => {
    // Both layers of the reporter path sanitise the same field. If the function were
    // not idempotent the second pass would rewrite a value the first had already
    // settled, and the two layers would disagree about the stored string.
    for (const input of [
      'tests/login.spec.ts',
      '../../etc/passwd',
      '/etc/passwd',
      'tests\\nested\\a.spec.ts',
      'report.json\0/../secret',
    ]) {
      const once = safeRelativePath(input);
      expect(safeRelativePath(once), `input ${JSON.stringify(input)}`).toBe(once);
    }
  });

  it('agrees with itself across both platforms, which is the point of it', () => {
    // The same logical path expressed both ways must collapse to one string.
    expect(safeRelativePath('tests\\a\\b.spec.ts')).toBe(safeRelativePath('tests/a/b.spec.ts'));
  });
});
