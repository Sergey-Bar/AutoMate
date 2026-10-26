import { describe, expect, it } from 'vitest';
import { testIdentity, testRowKey } from './test-identity.js';

describe('testIdentity', () => {
  it('keeps one test in two Playwright projects apart', () => {
    const chromium = testIdentity({ file: 'a.spec.ts', title: 'logs in', project: 'chromium' });
    const webkit = testIdentity({ file: 'a.spec.ts', title: 'logs in', project: 'webkit' });
    expect(chromium).not.toBe(webkit);
    expect(webkit).toBe('a.spec.ts › logs in [webkit]');
  });

  it('keeps one title in two describe blocks apart', () => {
    const guest = testIdentity({ file: 'a.spec.ts', describePath: ['guest'], title: 'checks out' });
    const member = testIdentity({
      file: 'a.spec.ts',
      describePath: ['member'],
      title: 'checks out',
    });
    expect(guest).not.toBe(member);
    expect(member).toBe('a.spec.ts › member › checks out');
  });

  it('is the legacy `file › title` key when there is no describe path or project', () => {
    // The backfill writes exactly this for every row recorded before the identity existed,
    // so a test's history does not split in two at the migration.
    expect(testIdentity({ file: 'a.spec.ts', title: 'logs in' })).toBe('a.spec.ts › logs in');
    expect(testIdentity({ file: null, title: 'logs in' })).toBe(' › logs in');
  });

  it('cannot be forged by a title that contains the separators', () => {
    // Without escaping, describe `a › b` + title `c` and describe `a` + title `b › c` are one
    // test, and a title ending in ` [webkit]` is the webkit project.
    expect(testIdentity({ file: 'f', describePath: ['a › b'], title: 'c' })).not.toBe(
      testIdentity({ file: 'f', describePath: ['a'], title: 'b › c' }),
    );
    expect(testIdentity({ file: 'f', title: 'x [webkit]' })).not.toBe(
      testIdentity({ file: 'f', title: 'x', project: 'webkit' }),
    );
    expect(testRowKey(testIdentity({ file: 'f', title: 'x {2}' }), 1)).not.toBe(
      testRowKey(testIdentity({ file: 'f', title: 'x' }), 2),
    );
  });

  it('gives a repeated test one identity and distinct row keys', () => {
    const identity = testIdentity({ file: 'f', title: 't', project: 'chromium' });
    expect(testRowKey(identity, 1)).toBe(identity);
    expect(testRowKey(identity, 2)).toBe('f › t [chromium] {2}');
  });

  it('treats an empty project and an empty describe path as absent', () => {
    expect(testIdentity({ file: 'f', title: 't', project: '', describePath: [] })).toBe('f › t');
    expect(testIdentity({ file: 'f', title: 't', describePath: ['', 'd'] })).toBe('f › d › t');
  });
});
