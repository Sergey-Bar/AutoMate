import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import { safePath } from '../utils/safe-path.js';
import { z } from 'zod';
import { parsePlaywrightConfig } from '../services/config-parser.js';
import { validateOrReply } from '../lib/validate-or-reply.js';

const DEFAULT_CONFIG_PATHS = [
  'playwright.config.ts',
  'playwright.config.mts',
  'playwright.config.js',
];

function findConfig(configPath?: string): string | null {
  const candidates = configPath ? [configPath] : DEFAULT_CONFIG_PATHS;
  for (const c of candidates) {
    try {
      const abs = safePath(process.cwd(), c);
      if (fs.existsSync(abs)) return abs;
    } catch {
      // Path traversal — skip this candidate
      continue;
    }
  }
  return null;
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/config — read raw playwright config file
  app.get<{ Querystring: { path?: string } }>('/api/config', async (req, reply): Promise<void> => {
    const configPath = findConfig(req.query.path);
    if (!configPath) return reply.status(404).send({ error: 'No playwright.config.ts found' });
    const content = fs.readFileSync(configPath, 'utf-8');
    return reply.send({ path: configPath, content });
  });

  // PUT /api/config — overwrite playwright config file
  app.put<{ Querystring: { path?: string }; Body: { content: string } }>(
    '/api/config',
    async (req, reply): Promise<void> => {
      const body = await validateOrReply(z.object({ content: z.string().min(1) }), req, reply);
      if (!body) return;

      const configPath = findConfig(req.query.path);
      if (!configPath) return reply.status(404).send({ error: 'No playwright.config.ts found' });

      // Backup before overwrite
      const backup = configPath + '.bak';
      fs.copyFileSync(configPath, backup);
      fs.writeFileSync(configPath, body.content, 'utf-8');
      return reply.send({ saved: true, path: configPath, backup });
    },
  );

  // GET /api/config/parsed — structurally parse config into projects + settings
  app.get<{ Querystring: { path?: string } }>('/api/config/parsed', async (req, reply): Promise<void> => {
    const configPath = findConfig(req.query.path);
    if (!configPath) return reply.status(404).send({ error: 'No playwright.config.ts found' });
    try {
      const parsed = parsePlaywrightConfig(configPath);
      return reply.send({ path: configPath, ...parsed });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Parse error';
      return reply.status(500).send({ error: message });
    }
  });
}
