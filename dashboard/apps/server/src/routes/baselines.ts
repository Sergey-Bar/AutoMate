/**
 * baselines.ts — server routes for screenshot baseline management
 *
 * GET  /api/baselines                 — list all baseline screenshots
 * POST /api/baselines/:file/accept    — accept actual as new expected
 * POST /api/baselines/accept-all      — accept all pending diffs
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { requireFeature } from '../services/feature-flags.js';
import { safePath } from '../utils/safe-path.js';
import { diffWithLooksSame, diffWithPipeline } from '../services/screenshot-diff.js';
import { getAiProvider } from '../services/ai-provider-registry.js';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), 'test-results');

interface BaselineEntry {
  id: string;
  testFile: string;
  snapshotName: string;
  expectedPath: string;
  actualPath: string | null;
  diffPath: string | null;
  hasActual: boolean;
  hasDiff: boolean;
  expectedSizeBytes: number;
}

export async function baselinesRoutes(app: FastifyInstance) {
  // GET /api/baselines — scan for all baseline screenshots
  app.get('/api/baselines', { preHandler: requireFeature('baseline-management') }, async (_req, reply) => {
    const baselines: BaselineEntry[] = [];

    // Scan test-results directory for snapshot files
    const scanDir = (dir: string, prefix = '') => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          scanDir(fullPath, relPath);
          continue;
        }

        // Look for expected screenshots (pattern: *-expected.png or files in __screenshots__)
        if (entry.name.endsWith('-expected.png') || entry.name.endsWith('.expected.png')) {
          const baseName = entry.name.replace(/-expected\.png$/, '').replace(/\.expected\.png$/, '');
          const actualName = `${baseName}-actual.png`;
          const diffName = `${baseName}-diff.png`;
          const actualPath = path.join(dir, actualName);
          const diffPath = path.join(dir, diffName);

          const stats = fs.statSync(fullPath);

          baselines.push({
            id: relPath,
            testFile: prefix.split('/')[0] ?? relPath,
            snapshotName: baseName,
            expectedPath: `/artifacts/${relPath}`,
            actualPath: fs.existsSync(actualPath) ? `/artifacts/${prefix ? `${prefix}/${actualName}` : actualName}` : null,
            diffPath: fs.existsSync(diffPath) ? `/artifacts/${prefix ? `${prefix}/${diffName}` : diffName}` : null,
            hasActual: fs.existsSync(actualPath),
            hasDiff: fs.existsSync(diffPath),
            expectedSizeBytes: stats.size,
          });
        }
      }
    };

    scanDir(ARTIFACTS_DIR);

    // Also scan common snapshot directories
    const snapshotDirs = ['__screenshots__', 'screenshots', 'snapshots'];
    for (const sd of snapshotDirs) {
      const sdPath = path.resolve(process.cwd(), sd);
      if (fs.existsSync(sdPath) && sdPath !== ARTIFACTS_DIR) {
        scanDir(sdPath);
      }
    }

    return reply.send(baselines);
  });

  // POST /api/baselines/:file/accept — copy actual → expected
  app.post<{ Params: { file: string } }>('/api/baselines/:file/accept', { preHandler: requireFeature('baseline-management') }, async (req, reply) => {
    const file = decodeURIComponent(req.params.file);
    let expectedPath: string;
    try {
      expectedPath = safePath(ARTIFACTS_DIR, file);
    } catch {
      return reply.status(400).send({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(expectedPath)) {
      return reply.status(404).send({ error: 'Expected file not found' });
    }

    const baseName = path.basename(expectedPath).replace(/-expected\.png$/, '').replace(/\.expected\.png$/, '');
    const dir = path.dirname(expectedPath);
    const actualPath = path.join(dir, `${baseName}-actual.png`);

    if (!fs.existsSync(actualPath)) {
      return reply.status(404).send({ error: 'No actual file to accept' });
    }

    // Backup expected, then copy actual → expected
    const backupPath = expectedPath + '.bak';
    fs.copyFileSync(expectedPath, backupPath);
    fs.copyFileSync(actualPath, expectedPath);

    // Remove the actual and diff files
    fs.unlinkSync(actualPath);
    const diffPath = path.join(dir, `${baseName}-diff.png`);
    if (fs.existsSync(diffPath)) fs.unlinkSync(diffPath);

    return reply.send({ accepted: true, file, backup: backupPath });
  });

  // POST /api/baselines/accept-all — accept all pending diffs
  app.post('/api/baselines/accept-all', { preHandler: requireFeature('baseline-management') }, async (_req, reply) => {
    let accepted = 0;
    const errors: string[] = [];

    const processDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          processDir(fullPath);
          continue;
        }

        if (entry.name.endsWith('-actual.png')) {
          const baseName = entry.name.replace(/-actual\.png$/, '');
          const expectedPath = path.join(dir, `${baseName}-expected.png`);

          try {
            if (fs.existsSync(expectedPath)) {
              fs.copyFileSync(expectedPath, expectedPath + '.bak');
            }
            fs.copyFileSync(fullPath, expectedPath);
            fs.unlinkSync(fullPath);
            const diffPath = path.join(dir, `${baseName}-diff.png`);
            if (fs.existsSync(diffPath)) fs.unlinkSync(diffPath);
            accepted++;
          } catch (err) {
            errors.push(entry.name);
          }
        }
      }
    };

    processDir(ARTIFACTS_DIR);
    return reply.send({ accepted, errors });
  });

  // POST /api/baselines/:file/compare — diff expected vs actual using pixelmatch
  app.post<{ Params: { file: string } }>('/api/baselines/:file/compare', { preHandler: requireFeature('screenshot-diff') }, async (req, reply) => {
    const file = decodeURIComponent(req.params.file);
    let expectedPath: string;
    try {
      expectedPath = safePath(ARTIFACTS_DIR, file);
    } catch {
      return reply.status(400).send({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(expectedPath)) {
      return reply.status(404).send({ error: 'Expected file not found' });
    }

    const baseName = path.basename(expectedPath).replace(/-expected\.png$/, '').replace(/\.expected\.png$/, '');
    const dir = path.dirname(expectedPath);
    const actualPath = path.join(dir, `${baseName}-actual.png`);

    if (!fs.existsSync(actualPath)) {
      return reply.status(404).send({ error: 'No actual file to compare' });
    }

    // Try to get AI config for the pipeline (optional — degrades gracefully if absent)
    let aiConfig: Parameters<typeof diffWithPipeline>[2] = undefined;
    try {
      const { config } = await getAiProvider();
      aiConfig = config;
    } catch {
      // No AI provider configured — run stages 1+2 only
    }

    const result = await diffWithPipeline(expectedPath, actualPath, aiConfig);
    return reply.send({
      ...result,
      diffStage: result.diffStage,
      ...(result.aiAnalysis !== undefined
        ? {
            aiAnalysis: {
              significant: result.aiAnalysis.significant,
              description: result.aiAnalysis.description,
            },
          }
        : {}),
    });
  });

  // POST /api/baselines/:file/compare-looks-same — diff expected vs actual using looks-same
  app.post<{ Params: { file: string } }>('/api/baselines/:file/compare-looks-same', { preHandler: requireFeature('looks-same-diff') }, async (req, reply) => {
    const file = decodeURIComponent(req.params.file);
    let expectedPath: string;
    try {
      expectedPath = safePath(ARTIFACTS_DIR, file);
    } catch {
      return reply.status(400).send({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(expectedPath)) {
      return reply.status(404).send({ error: 'Expected file not found' });
    }

    const baseName = path.basename(expectedPath).replace(/-expected\.png$/, '').replace(/\.expected\.png$/, '');
    const dir = path.dirname(expectedPath);
    const actualPath = path.join(dir, `${baseName}-actual.png`);

    if (!fs.existsSync(actualPath)) {
      return reply.status(404).send({ error: 'No actual file to compare' });
    }

    const result = await diffWithLooksSame(expectedPath, actualPath);
    return reply.send(result);
  });
}
