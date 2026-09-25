import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { blobShards, runs, tests, results } from '../db/schema.js';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const BLOBS_DIR = process.env.BLOBS_DIR ?? './data/blobs';

interface PlaywrightJsonReport {
  stats: {
    startTime: string;
    duration: number;
    expected: number;
    skipped: number;
    unexpected: number;
    flaky: number;
  };
  suites: Array<{
    title: string;
    file?: string;
    specs: Array<{
      title: string;
      ok: boolean;
      tags: string[];
      tests: Array<{
        timeout: number;
        annotations: Array<{ type: string; description?: string }>;
        expectedStatus: string;
        projectName: string;
        results: Array<{
          workerIndex: number;
          status: string;
          duration: number;
          startTime: string;
          retry: number;
          errors: Array<{ message: string; stack?: string }>;
          attachments: Array<{ name: string; contentType: string; path?: string }>;
          steps: unknown[];
        }>;
        status: string;
      }>;
    }>;
    suites?: unknown[];
  }>;
}

async function importMergedRun(runId: string, report: PlaywrightJsonReport): Promise<void> {
  const stats = report.stats;

  await db.transaction(async (tx) => {
    await tx.insert(runs).values({
      id: runId,
      startedAt: new Date(stats.startTime).toISOString(),
      finishedAt: new Date(new Date(stats.startTime).getTime() + stats.duration).toISOString(),
      status: stats.unexpected > 0 ? 'failed' : 'passed',
      total: stats.expected + stats.unexpected + stats.flaky + stats.skipped,
      passed: stats.expected,
      failed: stats.unexpected,
      flaky: stats.flaky,
      skipped: stats.skipped,
      durationMs: Math.round(stats.duration),
      source: 'blob',
      triggeredBy: 'blob',
    }).onConflictDoUpdate({
      target: runs.id,
      set: {
        finishedAt: new Date(new Date(stats.startTime).getTime() + stats.duration).toISOString(),
        status: stats.unexpected > 0 ? 'failed' : 'passed',
        total: stats.expected + stats.unexpected + stats.flaky + stats.skipped,
        passed: stats.expected,
        failed: stats.unexpected,
        flaky: stats.flaky,
        skipped: stats.skipped,
        durationMs: Math.round(stats.duration),
      },
    });

    // Collect all test and result rows, then batch insert
    const testRows: Array<{
      id: string;
      runId: string;
      title: string;
      file: string;
      status: 'passed' | 'failed' | 'flaky' | 'skipped' | 'timedOut' | 'running' | 'queued';
      tags: string;
      annotations: string;
      durationMs: number;
    }> = [];
    const resultRows: Array<{
      id: string;
      testId: string;
      runId: string;
      retry: number;
      status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
      durationMs: number;
      startedAt: string;
      errorMessage: string | null;
      errorStack: string | null;
      workerIndex: number;
    }> = [];

    for (const suite of report.suites) {
      const file = suite.file ?? suite.title;
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          const testId = randomUUID();
          testRows.push({
            id: testId,
            runId,
            title: spec.title,
            file,
            status: test.status as 'passed' | 'failed' | 'flaky' | 'skipped' | 'timedOut' | 'running' | 'queued',
            tags: JSON.stringify(spec.tags),
            annotations: JSON.stringify(test.annotations),
            durationMs: test.results.reduce((sum, r) => sum + r.duration, 0),
          });

          for (const r of test.results) {
            resultRows.push({
              id: randomUUID(),
              testId,
              runId,
              retry: r.retry,
              status: r.status as 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted',
              durationMs: r.duration,
              startedAt: r.startTime,
              errorMessage: r.errors[0]?.message ?? null,
              errorStack: r.errors[0]?.stack ?? null,
              workerIndex: r.workerIndex,
            });
          }
        }
      }
    }

    // Batch insert in chunks of 100
    const CHUNK_SIZE = 100;
    for (let i = 0; i < testRows.length; i += CHUNK_SIZE) {
      await tx.insert(tests).values(testRows.slice(i, i + CHUNK_SIZE)).onConflictDoNothing();
    }
    for (let i = 0; i < resultRows.length; i += CHUNK_SIZE) {
      await tx.insert(results).values(resultRows.slice(i, i + CHUNK_SIZE)).onConflictDoNothing();
    }
  });
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/ingest/blob — upload a shard blob
  app.post('/api/ingest/blob', async (req, reply): Promise<void> => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    // Validate content type - only accept ZIP archives
    const contentType = data.mimetype;
    const allowedTypes = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    if (!allowedTypes.includes(contentType)) {
      app.log.warn({ mimetype: contentType }, 'Invalid content type for blob upload');
      return reply.status(400).send({ 
        error: 'Invalid file type. Only ZIP archives are accepted.',
        received: contentType,
      });
    }

    const fields = data.fields as Record<string, { value: string }>;
    const runId = fields.runId?.value ?? randomUUID();
    const shardIndex = parseInt(fields.shardIndex?.value ?? '1', 10);
    const totalShards = parseInt(fields.totalShards?.value ?? '1', 10);

    const bodyParse = z.object({
      runId: z.string().uuid(),
      shardIndex: z.number().int().min(1),
      totalShards: z.number().int().min(1),
    }).safeParse({ runId, shardIndex, totalShards });

    if (!bodyParse.success) return reply.status(400).send({ error: bodyParse.error.flatten() });

    try {
      await mkdir(path.join(BLOBS_DIR, runId), { recursive: true });
      const filePath = path.join(BLOBS_DIR, runId, `shard-${shardIndex}.zip`);
      const buffer = await data.toBuffer();
      
      // Validate that we actually received data
      if (buffer.length === 0) {
        app.log.warn({ runId, shardIndex }, 'Empty blob upload');
        return reply.status(400).send({ error: 'Empty file uploaded' });
      }

      // Check file size against a reasonable maximum (500MB configured in multipart plugin)
      const maxSize = 500 * 1024 * 1024; // 500 MB
      if (buffer.length > maxSize) {
        app.log.warn({ runId, shardIndex, size: buffer.length }, 'Blob upload exceeds size limit');
        return reply.status(413).send({ 
          error: 'File too large',
          maxSize: `${maxSize / (1024 * 1024)} MB`,
          received: `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`,
        });
      }

      // Validate ZIP magic bytes (PK\x03\x04) — MIME types can be spoofed
      const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
        app.log.warn({ runId, shardIndex }, 'Blob upload is not a valid ZIP file (bad magic bytes)');
        return reply.status(400).send({
          error: 'Invalid file: not a valid ZIP archive (magic bytes mismatch)',
        });
      }

      await writeFile(filePath, buffer);

      const shardId = randomUUID();
      await db.insert(blobShards).values({
        id: shardId,
        runId,
        shardIndex,
        totalShards,
        filePath,
        uploadedAt: new Date().toISOString(),
        merged: false,
      });

      const uploaded = await db.select().from(blobShards);
      const uploadedForRun = uploaded.filter((s) => s.runId === runId && !s.merged);
      const allShardsUploaded = uploadedForRun.length >= totalShards;

      app.log.info({ runId, shardIndex, totalShards, allShardsUploaded }, 'Blob shard uploaded');

      return reply.status(201).send({ shardId, runId, shardIndex, totalShards, allShardsUploaded });
    } catch (err) {
      app.log.error({ err, runId, shardIndex }, 'Failed to save blob shard');
      return reply.status(500).send({ error: 'Failed to save blob shard' });
    }
  });

  // GET /api/ingest/blobs — list pending blob groups
  app.get('/api/ingest/blobs', async (_req, reply): Promise<void> => {
    const shards = await db.select().from(blobShards);
    const groups = new Map<string, typeof shards>();
    for (const s of shards) {
      if (!groups.has(s.runId)) groups.set(s.runId, []);
      groups.get(s.runId)!.push(s);
    }
    return reply.send(
      Array.from(groups.entries()).map(([rId, g]) => ({
        runId: rId,
        shards: g.length,
        totalShards: g[0]?.totalShards ?? 1,
        allUploaded: g.length >= (g[0]?.totalShards ?? 1),
        merged: g.every((s) => s.merged),
      }))
    );
  });

  // POST /api/ingest/blob/merge — merge uploaded shards into a run
  app.post('/api/ingest/blob/merge', async (req, reply): Promise<void> => {
    const body = z.object({ runId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'runId must be a valid UUID' });
    const { runId } = body.data;

    const allShards = await db.select().from(blobShards);
    const shards = allShards.filter((s) => s.runId === runId && !s.merged);
    if (!shards.length) return reply.status(404).send({ error: 'No unmerged shards found for runId' });

    const runDir = path.join(BLOBS_DIR, runId);

    try {
      const { stdout } = await execFileAsync(
        'npx',
        ['playwright', 'merge-reports', '--reporter', 'json', runDir],
        { timeout: 120_000, shell: false }
      );

      const report = JSON.parse(stdout) as PlaywrightJsonReport;
      await importMergedRun(runId, report);

      const shardIds = shards.map((s) => s.id);
      await db.update(blobShards).set({ merged: true }).where(inArray(blobShards.id, shardIds));

      return reply.send({ ok: true, runId });
    } catch (err) {
      app.log.error(err, 'merge-reports failed');
      return reply.status(500).send({ error: 'merge-reports failed', detail: String(err) });
    }
  });
}
