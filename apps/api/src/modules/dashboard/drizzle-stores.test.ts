import { describe, it, expect } from 'vitest';
import { DrizzleQualityGateStore, DrizzleQuarantineStore } from './drizzle-stores.js';
import { quarantine } from '@automate/db';

type QuarantineRow = {
  id: string;
  testTitle: string;
  testFile: string;
  reason: string | null;
  quarantinedAt: Date;
};

type QualityGateRow = {
  id: string;
  workspaceId: string | null;
  passRateThreshold: number;
  updatedAt: Date;
};

type FakeDbState = {
  quarantineRows: QuarantineRow[];
  qualityRows: QualityGateRow[];
  deleteRows: Array<{ id: string }>;
  insertedQuarantine: QuarantineRow[];
  insertedQuality: QualityGateRow[];
};

function createFakeDb(initial: Partial<FakeDbState> = {}) {
  const state: FakeDbState = {
    quarantineRows: initial.quarantineRows ?? [],
    qualityRows: initial.qualityRows ?? [],
    deleteRows: initial.deleteRows ?? [],
    insertedQuarantine: [],
    insertedQuality: [],
  };

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === quarantine) {
          return {
            orderBy: async (_expr: unknown) => state.quarantineRows,
          };
        }

        return {
          where: (_expr: unknown) => ({
            orderBy: async (_orderExpr: unknown) => state.qualityRows,
            limit: async (count: number) => state.qualityRows.slice(0, count),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: Record<string, unknown>) => {
        if (table === quarantine) {
          state.insertedQuarantine.push({
            id: String(value['id']),
            testTitle: String(value['testTitle']),
            testFile: String(value['testFile']),
            reason: (value['reason'] as string | null) ?? null,
            quarantinedAt: value['quarantinedAt'] as Date,
          });
          return;
        }

        state.insertedQuality.push({
          id: String(value['id']),
          workspaceId: (value['workspaceId'] as string | null) ?? null,
          passRateThreshold: Number(value['passRateThreshold']),
          updatedAt: value['updatedAt'] as Date,
        });
      },
    }),
    delete: (_table: unknown) => ({
      where: (_expr: unknown) => ({
        returning: async (_returnExpr: unknown) => state.deleteRows,
      }),
    }),
  };

  return { db, state };
}

describe('DrizzleQuarantineStore', () => {
  it('lists mapped quarantine entries', async () => {
    const { db } = createFakeDb({
      quarantineRows: [
        {
          id: 'q-1',
          testTitle: 'flaky login',
          testFile: 'e2e/login.spec.ts',
          reason: null,
          quarantinedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const store = new DrizzleQuarantineStore(db as never);
    const entries = await store.list();

    expect(entries).toEqual([
      {
        id: 'q-1',
        testTitle: 'flaky login',
        testFile: 'e2e/login.spec.ts',
        reason: null,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('adds quarantine entry via insert and returns created shape', async () => {
    const { db, state } = createFakeDb();
    const store = new DrizzleQuarantineStore(db as never);

    const created = await store.add({
      testTitle: 'flaky checkout',
      testFile: 'e2e/checkout.spec.ts',
      reason: 'CI instability',
    });

    expect(created.testTitle).toBe('flaky checkout');
    expect(created.testFile).toBe('e2e/checkout.spec.ts');
    expect(created.reason).toBe('CI instability');
    expect(typeof created.id).toBe('string');
    expect(typeof created.quarantinedAt).toBe('string');

    expect(state.insertedQuarantine).toHaveLength(1);
    expect(state.insertedQuarantine[0]?.testTitle).toBe('flaky checkout');
  });

  it('remove returns true when rows were deleted', async () => {
    const { db } = createFakeDb({ deleteRows: [{ id: 'q-1' }] });
    const store = new DrizzleQuarantineStore(db as never);

    await expect(store.remove('q-1')).resolves.toBe(true);
  });

  it('remove returns false when no rows were deleted', async () => {
    const { db } = createFakeDb({ deleteRows: [] });
    const store = new DrizzleQuarantineStore(db as never);

    await expect(store.remove('missing')).resolves.toBe(false);
  });
});

describe('DrizzleQualityGateStore', () => {
  it('lists mapped quality gates with fallback name', async () => {
    const { db } = createFakeDb({
      qualityRows: [
        {
          id: 'g-1',
          workspaceId: null,
          passRateThreshold: 95,
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const store = new DrizzleQualityGateStore(db as never);
    const gates = await store.list();

    expect(gates).toEqual([
      {
        id: 'g-1',
        name: 'Unnamed gate',
        passRateThreshold: 95,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('adds quality gate and returns created value', async () => {
    const { db, state } = createFakeDb();
    const store = new DrizzleQualityGateStore(db as never);

    const gate = await store.add({ name: 'Main gate', passRateThreshold: 90 });

    expect(gate.name).toBe('Main gate');
    expect(gate.passRateThreshold).toBe(90);
    expect(typeof gate.id).toBe('string');
    expect(typeof gate.createdAt).toBe('string');

    expect(state.insertedQuality).toHaveLength(1);
    expect(state.insertedQuality[0]?.workspaceId).toBe('Main gate');
  });

  it('get returns null when no gate exists', async () => {
    const { db } = createFakeDb({ qualityRows: [] });
    const store = new DrizzleQualityGateStore(db as never);

    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('get returns mapped gate when present', async () => {
    const { db } = createFakeDb({
      qualityRows: [
        {
          id: 'g-2',
          workspaceId: 'Release gate',
          passRateThreshold: 92,
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
    });
    const store = new DrizzleQualityGateStore(db as never);

    await expect(store.get('g-2')).resolves.toEqual({
      id: 'g-2',
      name: 'Release gate',
      passRateThreshold: 92,
      createdAt: '2026-01-03T00:00:00.000Z',
    });
  });
});
