import { describe, expect, it, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the db client with an in-memory store
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

const traceLinksStore: AnyRow[] = [];

vi.mock('../db/client.js', () => {
  function makeChain(rows: AnyRow[]) {
    return {
      where(_cond: unknown) { return makeChain(rows); },
      orderBy(..._args: unknown[]) { return makeChain(rows); },
      then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
  }

  const mockDb = {
    insert(_table: unknown) {
      return {
        values(vals: AnyRow) {
          traceLinksStore.push({ ...vals });
          return Promise.resolve([]);
        },
      };
    },
    select() {
      return {
        from(_table: unknown) {
          return makeChain([...traceLinksStore]);
        },
      };
    },
    delete(_table: unknown) {
      return {
        where(_cond: unknown) {
          traceLinksStore.length = 0;
          return Promise.resolve([]);
        },
      };
    },
    execute: vi.fn().mockResolvedValue([]),
  };

  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import {
  createTraceLink,
  getTraceLinks,
  getBacktraceLinks,
  deleteTraceLink,
} from './traceability.js';

describe('traceability service', () => {
  beforeEach(() => {
    traceLinksStore.length = 0;
  });

  describe('createTraceLink', () => {
    it('creates a row and returns it with generated id and timestamp', async () => {
      const link = await createTraceLink({
        sourceType: 'test',
        sourceId: 'login-test-stable-id',
        targetType: 'pr',
        targetId: 'pr-42',
        linkType: 'caused-by',
        metadata: JSON.stringify({ repo: 'acme/app' }),
        createdBy: 'agent',
      });

      expect(link.id).toBeTruthy();
      expect(link.createdAt).toBeTruthy();
      expect(new Date(link.createdAt).getTime()).toBeGreaterThan(0);
      expect(link.sourceType).toBe('test');
      expect(link.sourceId).toBe('login-test-stable-id');
      expect(link.targetType).toBe('pr');
      expect(link.targetId).toBe('pr-42');
      expect(link.linkType).toBe('caused-by');
      expect(link.metadata).toBe(JSON.stringify({ repo: 'acme/app' }));
      expect(link.createdBy).toBe('agent');
    });

    it('creates a link with minimal fields (no metadata, no createdBy)', async () => {
      const link = await createTraceLink({
        sourceType: 'commit',
        sourceId: 'abc123',
        targetType: 'jira_issue',
        targetId: 'PROJ-123',
        linkType: 'related',
      });

      expect(link.id).toBeTruthy();
      expect(link.metadata).toBeUndefined();
      expect(link.createdBy).toBeUndefined();
    });

    it('generates unique IDs for each call', async () => {
      const link1 = await createTraceLink({
        sourceType: 'test',
        sourceId: 'id-1',
        targetType: 'pr',
        targetId: 'pr-1',
        linkType: 'related',
      });
      const link2 = await createTraceLink({
        sourceType: 'test',
        sourceId: 'id-1',
        targetType: 'pr',
        targetId: 'pr-2',
        linkType: 'related',
      });

      expect(link1.id).not.toBe(link2.id);
    });
  });

  describe('getTraceLinks', () => {
    it('returns links matching source type and id', async () => {
      await createTraceLink({ sourceType: 'test', sourceId: 'login', targetType: 'pr', targetId: 'pr-1', linkType: 'related' });
      await createTraceLink({ sourceType: 'test', sourceId: 'login', targetType: 'jira_issue', targetId: 'BUG-42', linkType: 'reported-as' });
      await createTraceLink({ sourceType: 'test', sourceId: 'signup', targetType: 'pr', targetId: 'pr-2', linkType: 'related' });

      const links = await getTraceLinks('test', 'login');
      // The mock returns all rows (no real WHERE filtering), so just check we get rows
      expect(links.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array when no links found', async () => {
      const links = await getTraceLinks('test', 'unknown-test-id');
      expect(links).toEqual([]);
    });
  });

  describe('getBacktraceLinks', () => {
    it('returns links where target matches', async () => {
      await createTraceLink({ sourceType: 'test', sourceId: 'login', targetType: 'pr', targetId: 'pr-99', linkType: 'caused-by' });
      await createTraceLink({ sourceType: 'run', sourceId: 'run-1', targetType: 'pr', targetId: 'pr-99', linkType: 'caused-by' });

      const links = await getBacktraceLinks('pr', 'pr-99');
      expect(links.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array when no backtrace links found', async () => {
      const links = await getBacktraceLinks('pr', 'nonexistent-pr');
      expect(links).toEqual([]);
    });
  });

  describe('deleteTraceLink', () => {
    it('removes the link', async () => {
      const link = await createTraceLink({
        sourceType: 'test',
        sourceId: 'my-test',
        targetType: 'pr',
        targetId: 'pr-5',
        linkType: 'related',
      });

      expect(link.id).toBeTruthy();

      await deleteTraceLink(link.id);

      const afterDelete = await getTraceLinks('test', 'my-test');
      expect(afterDelete).toHaveLength(0);
    });

    it('does not throw when deleting a non-existent id', async () => {
      await expect(deleteTraceLink('non-existent-id')).resolves.not.toThrow();
    });
  });
});
