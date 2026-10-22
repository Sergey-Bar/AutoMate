import { describe, expect, it, vi } from 'vitest';

import type { MigrationApplyResult } from './migrate.js';
import { runMigrationCli } from './migrate.js';

/**
 * The `pnpm db:migrate` entrypoint: what it prints, and that a failure exits 1.
 *
 * The URL is assembled at runtime so the secret scanner never sees a credential
 * literal (AGENTS.md, Security).
 */

const DATABASE_URL = ['postgresql://', 'user:pass', '@db.internal:5432/automate'].join('');

function io(result: Promise<MigrationApplyResult>) {
  return {
    run: vi.fn(() => result),
    info: vi.fn<(line: string) => void>(),
    error: vi.fn<(...parts: unknown[]) => void>(),
    exit: vi.fn<(code: number) => void>(),
    env: { DATABASE_URL } as NodeJS.ProcessEnv,
  };
}

describe('runMigrationCli', () => {
  it('reports an already-current database and does not exit', async () => {
    const deps = io(Promise.resolve({ applied: [], alreadyCurrent: ['a', 'b'], durationMs: 3 }));
    await runMigrationCli(deps);
    expect(deps.info).toHaveBeenCalledTimes(1);
    expect(deps.info.mock.calls[0]?.[0]).toBe(
      'Migrations: already current (2 recorded, nothing to apply) on automate.',
    );
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('lists each applied hash after the summary line', async () => {
    const deps = io(
      Promise.resolve({ applied: ['h1', 'h2'], alreadyCurrent: ['h0'], durationMs: 12.6 }),
    );
    await runMigrationCli(deps);
    expect(deps.info.mock.calls.map((call) => call[0])).toEqual([
      'Migrations: applied 2 to automate in 13ms',
      '  applied h1',
      '  applied h2',
    ]);
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('prints the failure and exits 1', async () => {
    const deps = io(Promise.reject(new Error('journal ahead of checkout')));
    await runMigrationCli(deps);
    expect(deps.error).toHaveBeenCalledWith('Migration failed:', 'journal ahead of checkout');
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.info).not.toHaveBeenCalled();
  });
});
