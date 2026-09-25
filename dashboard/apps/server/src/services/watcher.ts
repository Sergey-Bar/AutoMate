/**
 * watcher.ts — chokidar artifact watcher
 *
 * Watches the test-results/ directory and broadcasts artifact:new events to
 * all connected browser clients whenever a new screenshot, video or trace is detected.
 */
import chokidar from 'chokidar';
import * as path from 'path';
import type { ReporterBridge } from './reporter-bridge.js';

const ARTIFACT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webm', '.mp4', '.zip']);

export function startWatcher(artifactsDir: string, bridge: ReporterBridge) {
  const watcher = chokidar.watch(artifactsDir, {
    ignoreInitial: true,
    persistent: true,
    depth: 6,
  });

  watcher.on('add', (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!ARTIFACT_EXTS.has(ext)) return;

    const relativePath = path.relative(artifactsDir, filePath);
    const type = detectArtifactType(ext, relativePath);

    bridge.broadcast({
      type: 'artifact:new',
      runId: extractRunId(relativePath) ?? '__unknown__',
      payload: { path: relativePath, absolutePath: filePath, artifactType: type },
    });
  });

  return watcher;
}

function detectArtifactType(ext: string, relativePath: string): string {
  if (ext === '.zip') return 'trace';
  if (ext === '.webm' || ext === '.mp4') return 'video';
  if (relativePath.includes('diff')) return 'diff';
  if (relativePath.includes('expected')) return 'expected';
  if (relativePath.includes('actual')) return 'actual';
  return 'screenshot';
}

/** Best-effort: parse run ID from directory structure test-results/<runId>/... */
function extractRunId(relativePath: string): string | undefined {
  const parts = relativePath.split(path.sep);
  return parts[0]; // first segment is commonly the test name / run dir
}
