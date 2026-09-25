import { describe, expect, it, vi, beforeEach } from 'vitest';
import { traceabilityManifest } from './traceability.js';

const mockCreateTraceLink = vi.hoisted(() => vi.fn());
const mockGetTraceLinks = vi.hoisted(() => vi.fn());

vi.mock('../services/traceability.js', () => ({
  createTraceLink: mockCreateTraceLink,
  getTraceLinks: mockGetTraceLinks,
  getBacktraceLinks: vi.fn(),
  deleteTraceLink: vi.fn(),
}));

const ctx = { credentials: {}, abortSignal: new AbortController().signal };

describe('traceabilityManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the correct connector name and two tools', () => {
    expect(traceabilityManifest.name).toBe('traceability');
    expect(traceabilityManifest.tools).toHaveLength(2);
    expect(traceabilityManifest.tools[0]?.name).toBe('get_trace');
    expect(traceabilityManifest.tools[1]?.name).toBe('link_artifacts');
  });

  describe('get_trace', () => {
    it('returns formatted list of linked artifacts', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          sourceType: 'test',
          sourceId: 'login-test',
          targetType: 'pr',
          targetId: 'pr-42',
          linkType: 'caused-by',
          metadata: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: null,
        },
      ];
      mockGetTraceLinks.mockResolvedValue(mockLinks);

      const tool = traceabilityManifest.tools[0];
      const result = await tool!.handler({ sourceType: 'test', sourceId: 'login-test' }, ctx);

      expect(result.isError).toBe(false);
      expect(mockGetTraceLinks).toHaveBeenCalledWith('test', 'login-test');
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.sourceType).toBe('test');
      expect(parsed.sourceId).toBe('login-test');
      expect(parsed.links).toEqual(mockLinks);
      expect(parsed.count).toBe(1);
    });

    it('returns empty list (not error) when sourceId has no links', async () => {
      mockGetTraceLinks.mockResolvedValue([]);

      const tool = traceabilityManifest.tools[0];
      const result = await tool!.handler({ sourceType: 'test', sourceId: 'unknown-id' }, ctx);

      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.links).toEqual([]);
      expect(parsed.count).toBe(0);
    });

    it('returns error when sourceId is missing', async () => {
      const tool = traceabilityManifest.tools[0];
      const result = await tool!.handler({ sourceType: 'test', sourceId: '' }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Error');
      expect(mockGetTraceLinks).not.toHaveBeenCalled();
    });

    it('tool description mentions linked artifacts', () => {
      const tool = traceabilityManifest.tools[0];
      expect(tool?.description.toLowerCase()).toContain('linked');
    });
  });

  describe('link_artifacts', () => {
    it('creates a link and returns { linked: true, id }', async () => {
      const mockLink = {
        id: 'generated-uuid',
        sourceType: 'test',
        sourceId: 'login-test',
        targetType: 'pr',
        targetId: 'pr-42',
        linkType: 'caused-by',
        metadata: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: null,
      };
      mockCreateTraceLink.mockResolvedValue(mockLink);

      const tool = traceabilityManifest.tools[1];
      const result = await tool!.handler({
        sourceType: 'test',
        sourceId: 'login-test',
        targetType: 'pr',
        targetId: 'pr-42',
        linkType: 'caused-by',
      }, ctx);

      expect(result.isError).toBe(false);
      expect(mockCreateTraceLink).toHaveBeenCalledWith({
        sourceType: 'test',
        sourceId: 'login-test',
        targetType: 'pr',
        targetId: 'pr-42',
        linkType: 'caused-by',
        metadata: undefined,
      });
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.linked).toBe(true);
      expect(parsed.id).toBe('generated-uuid');
    });

    it('uses default linkType "related" when not provided', async () => {
      const mockLink = { id: 'uuid-2', sourceType: 'run', sourceId: 'r1', targetType: 'jira_issue', targetId: 'BUG-1', linkType: 'related', metadata: null, createdAt: '2024-01-01T00:00:00.000Z', createdBy: null };
      mockCreateTraceLink.mockResolvedValue(mockLink);

      const tool = traceabilityManifest.tools[1];
      await tool!.handler({
        sourceType: 'run',
        sourceId: 'r1',
        targetType: 'jira_issue',
        targetId: 'BUG-1',
      }, ctx);

      expect(mockCreateTraceLink).toHaveBeenCalledWith(expect.objectContaining({
        linkType: 'related',
      }));
    });

    it('returns error when required fields are missing', async () => {
      const tool = traceabilityManifest.tools[1];
      const result = await tool!.handler({ sourceType: 'test', sourceId: '' }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Error');
      expect(mockCreateTraceLink).not.toHaveBeenCalled();
    });

    it('passes metadata through to createTraceLink', async () => {
      const mockLink = { id: 'uuid-3', sourceType: 'test', sourceId: 'test-1', targetType: 'pr', targetId: 'pr-3', linkType: 'fixed-by', metadata: '{"repo":"org/repo"}', createdAt: '2024-01-01T00:00:00.000Z', createdBy: null };
      mockCreateTraceLink.mockResolvedValue(mockLink);

      const tool = traceabilityManifest.tools[1];
      await tool!.handler({
        sourceType: 'test',
        sourceId: 'test-1',
        targetType: 'pr',
        targetId: 'pr-3',
        linkType: 'fixed-by',
        metadata: '{"repo":"org/repo"}',
      }, ctx);

      expect(mockCreateTraceLink).toHaveBeenCalledWith(expect.objectContaining({
        metadata: '{"repo":"org/repo"}',
      }));
    });
  });
});
