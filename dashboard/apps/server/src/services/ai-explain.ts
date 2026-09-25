/**
 * apps/server/src/services/ai-explain.ts — AI failure explanation service
 *
 * Routes:
 *   POST /api/ai/explain — Generate AI explanation for test failures
 *   GET  /api/ai/config  — Read current AI configuration
 *   PUT  /api/ai/config  — Update AI configuration
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AiProviderConfigSchema } from '@automate/dashboard-shared';
import type { AiProviderConfig } from '@automate/dashboard-shared';
import { requireFeature, isEnabled } from './feature-flags.js';
import { providerRegistry } from './ai-provider-registry.js';
import { runCritic } from './ai-critic.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const explainBodySchema = z.object({
  error: z.string(),
  stack: z.string().optional(),
  testCode: z.string().optional(),
  specContext: z.string().optional(),
});

// ── Config Management ─────────────────────────────────────────────────────────

const CONFIG_DIR = path.resolve(process.cwd(), '.automate');
const CONFIG_PATH = path.join(CONFIG_DIR, 'ai-config.json');

async function readConfig(): Promise<AiProviderConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return AiProviderConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeConfig(config: AiProviderConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function buildSpecContext(specSnippet: string, endpoint: string, expectedStatus: number): string {
  return `Endpoint: ${endpoint}\nExpected Status: ${expectedStatus}\nSpec Snippet:\n${specSnippet}`;
}

export async function aiRoutes(app: FastifyInstance) {
  // POST /api/ai/explain — Generate AI explanation for test failures
  app.post<{ Body: z.infer<typeof explainBodySchema> }>(
    '/api/ai/explain',
    {
      preHandler: requireFeature('ai-explain'),
      schema: {
        body: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            stack: { type: 'string' },
            testCode: { type: 'string' },
            specContext: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { error, stack, testCode, specContext } = explainBodySchema.parse(request.body);

      const config = await readConfig();
      if (!config) {
        return reply.status(404).send({ error: 'AI not configured' });
      }

      const adapter = providerRegistry.getAdapter(config.provider);
      if (!adapter) {
        return reply.status(400).send({ error: `Provider ${config.provider} is not supported` });
      }

      // Build prompt
      const sections = [
        'Analyze this test failure and provide:',
        '1. A brief summary (2-3 sentences) of what likely went wrong',
        '2. A specific, actionable suggestion to fix it',
        '',
        `Error: ${error}`,
      ];

      // Inject spec context after error if feature enabled and context provided
      if (isEnabled('spec-aware-triage') && specContext) {
        sections.push('', `API Specification Context:\n${specContext}`);
      }

      if (stack) {
        sections.push('', `Stack trace:\n${stack.split('\n').slice(0, 10).join('\n')}`);
      }

      if (testCode) {
        sections.push('', `Test code:\n${testCode.slice(0, 500)}`);
      }

      const prompt = sections.join('\n');

      try {
        const aiResponse = await adapter.createCompletion(prompt, config);

        // Parse response into summary + suggestion
        const lines = aiResponse.split('\n').filter((l) => l.trim());
        const summaryLines: string[] = [];
        const suggestionLines: string[] = [];
        let inSuggestion = false;

        for (const line of lines) {
          if (line.match(/suggestion|fix|solution|try|recommend/i)) {
            inSuggestion = true;
          }
          if (inSuggestion) {
            suggestionLines.push(line);
          } else {
            summaryLines.push(line);
          }
        }

        const summary = summaryLines.join('\n').trim() || aiResponse.slice(0, 200);
        const suggestion = suggestionLines.join('\n').trim() || 'Review the error details above';

        // Calculate confidence based on response quality
        const confidence = aiResponse.length > 50 && aiResponse.includes('test') ? 0.8 : 0.5;

        // Dual-agent RCA: run critic if configured
        if (config.dualAgentRca === true) {
          const critic = await runCritic({
            error,
            stack,
            testCode,
            analyzerSummary: summary,
            analyzerSuggestion: suggestion,
            config,
          });
          const finalSummary = critic.adjustedSummary ?? summary;
          const finalSuggestion = critic.adjustedSuggestion ?? suggestion;
          return {
            summary: finalSummary,
            suggestion: finalSuggestion,
            confidence: critic.confidence,
            criticConfidence: critic.confidence,
            critique: critic.critique,
            validated: critic.validated,
          };
        }

        return { summary, suggestion, confidence };
      } catch (err) {
        app.log.error({ err }, 'AI explain failed');
        return reply.status(500).send({
          error: 'Failed to generate explanation',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // GET /api/ai/config — Read current AI configuration
  app.get('/api/ai/config', { preHandler: requireFeature('ai-explain') }, async (_request, reply) => {
    const config = await readConfig();
    if (!config) {
      return reply.status(404).send({ error: 'AI not configured' });
    }

    // Mask the API key if present
    const masked: Record<string, unknown> = { ...config };
    if ('apiKey' in masked && typeof masked['apiKey'] === 'string') {
      const key = masked['apiKey'];
      masked['apiKey'] = key.slice(0, 8) + '...' + key.slice(-4);
    }
    return masked;
  });

  // PUT /api/ai/config — Update AI configuration
  app.put<{ Body: AiProviderConfig }>(
    '/api/ai/config',
    {
      preHandler: requireFeature('ai-explain'),
      schema: {
        body: { type: 'object' },
      },
    },
    async (request) => {
      const config = AiProviderConfigSchema.parse(request.body);
      await writeConfig(config);
      return { success: true };
    },
  );
}
