import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import chokidar from 'chokidar';
import { startWatcher } from '../watcher.js';
import { ReporterBridge } from '../reporter-bridge.js';
import type { FastifyBaseLogger } from 'fastify';

type HandlerMap = Record<string, (arg: string) => void>;

const mockState = vi.hoisted(() => {
  const onHandlers: HandlerMap = {};
  const mockWatcher = {
    on: vi.fn((event: string, handler: (arg: string) => void) => {
      onHandlers[event] = handler;
      return mockWatcher;
    }),
    close: vi.fn(),
    _onHandlers: onHandlers,
  };

  return {
    watch: vi.fn(() => mockWatcher),
    mockWatcher,
    onHandlers,
  };
});

vi.mock('chokidar', () => ({
  default: {
    watch: mockState.watch,
  },
}));

describe('startWatcher', () => {
  const artifactsDir = path.join('workspace', 'test-results');

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockState.onHandlers)) {
      delete mockState.onHandlers[key];
    }
  });

  function createBridge() {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
      level: 'info',
      silent: vi.fn(),
    } as unknown as FastifyBaseLogger;

    return new ReporterBridge(logger);
  }

  function emitAdd(filePath: string): void {
    const handler = mockState.onHandlers.add;
    expect(handler).toBeTypeOf('function');
    handler(filePath);
  }

  it('calls chokidar.watch with required options', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');

    const watcher = startWatcher(artifactsDir, bridge);

    expect(chokidar.watch).toHaveBeenCalledWith(artifactsDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 6,
    });
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(watcher).toBe(mockState.mockWatcher);
  });

  it('broadcasts screenshot artifact for .png on add', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');
    startWatcher(artifactsDir, bridge);

    const filePath = path.join(artifactsDir, 'run-111', 'screens', 'img.png');
    emitAdd(filePath);

    expect(broadcastSpy).toHaveBeenCalledWith({
      type: 'artifact:new',
      runId: 'run-111',
      payload: {
        path: path.join('run-111', 'screens', 'img.png'),
        absolutePath: filePath,
        artifactType: 'screenshot',
      },
    });
  });

  it('maps .webm and .mp4 to video type', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');
    startWatcher(artifactsDir, bridge);

    emitAdd(path.join(artifactsDir, 'run-222', 'video', 'clip.webm'));
    emitAdd(path.join(artifactsDir, 'run-222', 'video', 'clip.mp4'));

    const calls = broadcastSpy.mock.calls.map((c) => c[0].payload.artifactType);
    expect(calls).toEqual(['video', 'video']);
  });

  it('maps .zip to trace type', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');
    startWatcher(artifactsDir, bridge);

    emitAdd(path.join(artifactsDir, 'run-333', 'trace', 'trace.zip'));

    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ artifactType: 'trace' }) }),
    );
  });

  it('detects diff/expected/actual path-based screenshot categories', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');
    startWatcher(artifactsDir, bridge);

    emitAdd(path.join(artifactsDir, 'run-444', 'snapshots', 'foo-diff.png'));
    emitAdd(path.join(artifactsDir, 'run-444', 'snapshots', 'foo-expected.png'));
    emitAdd(path.join(artifactsDir, 'run-444', 'snapshots', 'foo-actual.png'));

    const artifactTypes = broadcastSpy.mock.calls.map((c) => c[0].payload.artifactType);
    expect(artifactTypes).toEqual(['diff', 'expected', 'actual']);
  });

  it('ignores non-artifact extensions', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');
    startWatcher(artifactsDir, bridge);

    emitAdd(path.join(artifactsDir, 'run-555', 'meta', 'report.txt'));
    emitAdd(path.join(artifactsDir, 'run-555', 'meta', 'report.json'));
    emitAdd(path.join(artifactsDir, 'run-555', 'meta', 'report.html'));

    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('extracts runId from first path segment', () => {
    const bridge = createBridge();
    const broadcastSpy = vi.spyOn(bridge, 'broadcast');
    startWatcher(artifactsDir, bridge);

    const filePath = path.join(artifactsDir, 'my-run-id', 'x', 'shot.png');
    emitAdd(filePath);

    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'my-run-id',
      }),
    );
  });

  it('returns the watcher instance', () => {
    const bridge = createBridge();
    const watcher = startWatcher(artifactsDir, bridge);
    expect(watcher).toBe(mockState.mockWatcher);
  });
});
