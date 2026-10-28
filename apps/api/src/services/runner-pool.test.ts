import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { poolCapabilities } from './runner-pool.js';

/**
 * The runner pool a health scan is offered (ADR-014). Runners are one pool the installation
 * shares: every runner registers in the default workspace and claims any workspace's jobs. A
 * scan in another workspace was offered only the runners registered there — none — so every
 * scanner read as not configured outside the default.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function runner(
  db: MigratedDb,
  health: 'healthy' | 'degraded' | 'offline',
  capabilities: string[],
): Promise<void> {
  const id = randomUUID();
  await db.insert(schema.runners).values({
    id,
    workspaceId: 'ws-1',
    name: `runner-${health}`,
    version: '1',
    os: 'linux',
    arch: 'x64',
    tokenHash: `hash-${id}`,
    tokenExpiresAt: new Date(Date.now() + 86_400_000),
    health,
    slots: 1,
    capabilities,
    labels: [],
  } as never);
}

describe('the runner pool a health scan is offered', () => {
  it("is every live runner's capabilities, whichever workspace's scan asks", async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    await runner(db, 'healthy', ['semgrep']);
    await runner(db, 'degraded', ['zap']);
    await runner(db, 'offline', ['trivy']);
    // The query takes no workspace: the pool is the installation's, so a scan in ws-2 is
    // offered the runners registered in ws-1 exactly as a scan there is.
    expect([...(await poolCapabilities({ db: db as never }))].sort()).toEqual(['semgrep', 'zap']);
  });
});
