/**
 * codegen.ts — server routes for Playwright codegen integration
 *
 * POST /api/codegen/start  — spawn `npx playwright codegen <url>`
 * POST /api/codegen/stop   — kill running codegen process
 * POST /api/codegen/save   — write generated code to a file
 * GET  /api/codegen/status — check if codegen is running
 */
import type { FastifyInstance } from 'fastify';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { requireFeature } from '../services/feature-flags.js';
import { safePath } from '../utils/safe-path.js';

let codegenProcess: ChildProcess | null = null;
let codegenOutput = '';

export async function codegenRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/codegen/start — launch codegen
  app.post('/api/codegen/start', { preHandler: requireFeature('codegen-launcher') }, async (req, reply): Promise<void> => {
    const body = z
      .object({
        url: z.string().url().default('http://localhost:3000'),
        browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
        outputPath: z.string().optional(),
        language: z.enum(['javascript', 'typescript', 'python', 'csharp', 'java']).default('typescript'),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: body.error.flatten() });
    }

    // Kill any existing process
    if (codegenProcess && !codegenProcess.killed) {
      codegenProcess.kill('SIGTERM');
      codegenProcess = null;
    }

    codegenOutput = '';
    const { url, browser, outputPath, language } = body.data;

    const args = ['playwright', 'codegen'];
    args.push('--browser', browser);
    args.push('--target', language);
    if (outputPath) args.push('--output', outputPath);
    args.push(url);

    try {
      codegenProcess = spawn('npx', args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      codegenProcess.stdout?.on('data', (data: Buffer) => {
        if (codegenOutput.length < 1_048_576) codegenOutput += data.toString();
      });

      codegenProcess.stderr?.on('data', (data: Buffer) => {
        if (codegenOutput.length < 1_048_576) codegenOutput += data.toString();
      });

      codegenProcess.on('close', (code) => {
        app.log.info(`Codegen process exited with code ${code}`);
        codegenProcess = null;
      });

      codegenProcess.on('error', (err) => {
        app.log.error(`Codegen spawn error: ${err.message}`);
        codegenProcess = null;
      });

      return reply.send({
        started: true,
        pid: codegenProcess.pid,
        browser,
        url,
        language,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start codegen';
      return reply.status(500).send({ error: message });
    }
  });

  // POST /api/codegen/stop — kill running codegen
  app.post('/api/codegen/stop', { preHandler: requireFeature('codegen-launcher') }, async (_req, reply): Promise<void> => {
    if (!codegenProcess || codegenProcess.killed) {
      return reply.send({ stopped: false, reason: 'No running codegen process' });
    }
    codegenProcess.kill('SIGTERM');
    codegenProcess = null;
    return reply.send({ stopped: true });
  });

  // GET /api/codegen/status — check codegen state
  app.get('/api/codegen/status', { preHandler: requireFeature('codegen-launcher') }, async (_req, reply): Promise<void> => {
    return reply.send({
      running: codegenProcess != null && !codegenProcess.killed,
      pid: codegenProcess?.pid ?? null,
      outputLength: codegenOutput.length,
    });
  });

  // GET /api/codegen/output — get captured output
  app.get('/api/codegen/output', { preHandler: requireFeature('codegen-launcher') }, async (_req, reply): Promise<void> => {
    return reply.send({ output: codegenOutput });
  });

  // POST /api/codegen/save — save generated code to file
  app.post('/api/codegen/save', { preHandler: requireFeature('codegen-launcher') }, async (req, reply): Promise<void> => {
    const body = z
      .object({
        content: z.string().min(1),
        filePath: z.string().min(1),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'content and filePath are required' });
    }

    const { content, filePath: relPath } = body.data;
    let absPath: string;
    try {
      absPath = safePath(process.cwd(), relPath);
    } catch (err) {
      app.log.warn({ relPath, err }, 'Invalid file path in codegen save');
      return reply.status(400).send({ error: 'Invalid file path' });
    }

    // Ensure directory exists
    const dir = path.dirname(absPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Don't overwrite without backup
      if (fs.existsSync(absPath)) {
        fs.copyFileSync(absPath, absPath + '.bak');
      }

      fs.writeFileSync(absPath, content, 'utf-8');
      return reply.send({ saved: true, path: absPath });
    } catch (err) {
      app.log.error({ err, absPath }, 'Failed to save codegen file');
      return reply.status(500).send({ error: 'Failed to save file' });
    }
  });
}
