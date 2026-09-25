/**
 * test-generation.ts — Routes for NL → Playwright test generation
 *
 * POST /api/test-generation/generate — Generate a Playwright test from a NL description
 * POST /api/test-generation/save     — Write generated code to a file on disk
 */
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { requireFeature } from '../services/feature-flags.js';
import { safePath } from '../utils/safe-path.js';
import { generate } from '../services/test-generator.js';

export async function testGenerationRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/test-generation/generate — NL → Playwright test
  app.post(
    '/api/test-generation/generate',
    { preHandler: requireFeature('test-generation') },
    async (req, reply): Promise<void> => {
      const body = z
        .object({
          description: z.string().min(1, 'description is required'),
          baseUrl: z.string().optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid parameters', details: body.error.flatten() });
      }

      try {
        const result = await generate({
          description: body.data.description,
          baseUrl: body.data.baseUrl,
          framework: 'playwright',
        });
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'No AI provider configured') {
          return reply.status(404).send({ error: 'No AI provider configured' });
        }
        app.log.error({ err }, 'test-generation generate failed');
        return reply.status(500).send({ error: message });
      }
    },
  );

  // POST /api/test-generation/save — Write generated code to file
  app.post(
    '/api/test-generation/save',
    { preHandler: requireFeature('test-generation') },
    async (req, reply): Promise<void> => {
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
        app.log.warn({ relPath, err }, 'Invalid file path in test-generation save');
        return reply.status(400).send({ error: 'Invalid file path' });
      }

      const dir = path.dirname(absPath);
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(absPath)) {
          fs.copyFileSync(absPath, absPath + '.bak');
        }

        fs.writeFileSync(absPath, content, 'utf-8');
        return reply.send({ saved: true, path: absPath });
      } catch (err) {
        app.log.error({ err, absPath }, 'Failed to save test-generation file');
        return reply.status(500).send({ error: 'Failed to save file' });
      }
    },
  );
}
