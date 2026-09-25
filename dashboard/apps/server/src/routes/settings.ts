import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadRetentionConfig,
  saveRetentionConfig,
  runRetentionCleanup,
  getDbStats,
  type RetentionConfig,
} from '../services/data-retention.js';

/**
 * Auto-quarantine settings routes
 * Uses filesystem config pattern (.automate/auto-quarantine.json)
 */

const CONFIG_PATH = path.resolve(process.cwd(), '.automate', 'auto-quarantine.json');

const DEFAULT_CONFIG = {
  flakyThreshold: 3,
  lookbackRuns: 10,
};

const AutoQuarantineSchema = z.object({
  flakyThreshold: z.number().min(1),
  lookbackRuns: z.number().min(1),
});

const RetentionConfigSchema = z.object({
  testResultDays: z.number().min(1),
  nlQueryHistoryDays: z.number().min(1),
  attachmentDays: z.number().min(1),
  trendsDays: z.number().min(-1), // -1 = forever
  enabled: z.boolean(),
});

function loadAutoQuarantineConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

function saveAutoQuarantineConfig(config: { flakyThreshold: number; lookbackRuns: number }) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function registerSettingsRoutes(app: FastifyInstance) {
  const _dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

  // GET /api/settings/auto-quarantine
  app.get('/api/settings/auto-quarantine', async (_req, reply) => {
    const config = loadAutoQuarantineConfig();
    return reply.send(config);
  });

  // PUT /api/settings/auto-quarantine
  app.put('/api/settings/auto-quarantine', async (req, reply) => {
    const body = AutoQuarantineSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    saveAutoQuarantineConfig(body.data);
    return reply.send({ ok: true });
  });

  // ── Data Retention ──────────────────────────────────────────────────────

  // GET /api/settings/data-retention
  app.get('/api/settings/data-retention', async (_req, reply) => {
    const config = loadRetentionConfig();
    return reply.send(config);
  });

  // PUT /api/settings/data-retention
  app.put('/api/settings/data-retention', async (req, reply) => {
    const body = RetentionConfigSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }
    saveRetentionConfig(body.data as RetentionConfig);
    return reply.send({ ok: true });
  });

  // POST /api/settings/data-retention/run — trigger manual cleanup
  app.post('/api/settings/data-retention/run', async (_req, reply) => {
    const config = loadRetentionConfig();
    const result = await runRetentionCleanup(config);
    return reply.send(result);
  });

  // GET /api/settings/db-stats — database size monitoring
  app.get('/api/settings/db-stats', async (_req, reply) => {
    const stats = getDbStats();
    return reply.send(stats);
  });

  // GET /api/settings/backup — not supported with PostgreSQL
  app.get('/api/settings/backup', async (_req, reply) => {
    return reply.status(501).send({ error: 'Database backup is not supported with PostgreSQL. Use pg_dump instead.' });
  });

  // POST /api/settings/restore — not supported with PostgreSQL
  app.post('/api/settings/restore', async (_req, reply) => {
    return reply.status(501).send({ error: 'Database restore is not supported with PostgreSQL. Use pg_restore instead.' });
  });
}

// Export function to read config from auto-quarantine service
export function getAutoQuarantineConfig() {
  return loadAutoQuarantineConfig();
}
