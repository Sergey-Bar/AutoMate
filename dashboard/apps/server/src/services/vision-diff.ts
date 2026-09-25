/**
 * vision-diff.ts — AI vision analysis for screenshot comparison
 *
 * Calls the configured AI provider directly with base64-encoded image data.
 * Bypasses the chat adapter stack (which only handles text).
 * Only called when supportsVision() returns true for the configured provider.
 */

import * as fs from 'fs/promises';
import type { AiProviderConfig } from '@automate/dashboard-shared';

const TIMEOUT_MS = 30_000;

const VISION_PROMPT =
  'Compare these two screenshots. Are the differences visually significant to a user? Ignore: timestamps, cursor positions, loading spinners, scroll positions. Focus on: layout shifts, missing elements, color changes, text changes, broken UI. Respond with JSON only: { "significant": boolean, "description": string, "regions": string[] }';

export interface VisionDiffResult {
  significant: boolean;
  description: string;
  regions: string[];
}

async function toBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString('base64');
}

function parseVisionResponse(text: string): VisionDiffResult {
  try {
    // Try to extract JSON from the response (model may add extra text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch?.[0] ?? text;
    const parsed = JSON.parse(jsonStr) as { significant?: unknown; description?: unknown; regions?: unknown };
    return {
      significant: typeof parsed.significant === 'boolean' ? parsed.significant : false,
      description: typeof parsed.description === 'string' ? parsed.description : text,
      regions: Array.isArray(parsed.regions) ? (parsed.regions as string[]) : [],
    };
  } catch {
    return { significant: false, description: text, regions: [] };
  }
}

export async function analyzeVisionDiff(
  expectedPath: string,
  actualPath: string,
  config: AiProviderConfig,
): Promise<VisionDiffResult> {
  const [expectedBase64, actualBase64] = await Promise.all([
    toBase64(expectedPath),
    toBase64(actualPath),
  ]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    if (config.provider === 'openai') {
      const baseUrl = config.baseUrl ?? 'https://api.openai.com';
      const endpoint = `${baseUrl}/v1/chat/completions`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: VISION_PROMPT },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${expectedBase64}` },
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${actualBase64}` },
                },
              ],
            },
          ],
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Vision API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return parseVisionResponse(text);
    }

    if (config.provider === 'google') {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: VISION_PROMPT },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${expectedBase64}` },
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${actualBase64}` },
                },
              ],
            },
          ],
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Vision API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      return parseVisionResponse(text);
    }

    throw new Error(`Provider ${config.provider} does not support vision`);
  } finally {
    clearTimeout(timeout);
  }
}
