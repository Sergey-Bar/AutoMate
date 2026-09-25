/**
 * vision-diff.test.ts — unit tests for analyzeVisionDiff()
 *
 * HTTP mocking via globalThis.fetch = vi.fn() (NO MSW).
 */

import * as os from 'os';
import * as path from 'path';
import * as fsSync from 'fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeVisionDiff } from '../vision-diff.js';
import type { AiProviderConfig } from '@automate/dashboard-shared';

// ── fetch mock ────────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal 1×1 PNG as Buffer */
function minimalPng(): Buffer {
  // 1x1 red pixel PNG (hardcoded minimal valid PNG bytes)
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e00000000c4944415478016360f8cfc00000000200019e221bc0000000049454e44ae426082',
    'hex',
  );
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'vision-diff-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  fsSync.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmpPng(name: string): string {
  const filePath = path.join(tmpDir, name);
  fsSync.writeFileSync(filePath, minimalPng());
  return filePath;
}

const openAiConfig: AiProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'test-key',
};

const googleConfig: AiProviderConfig = {
  provider: 'google',
  model: 'gemini-1.5-pro',
  apiKey: 'test-key',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('analyzeVisionDiff', () => {
  it('returns parsed JSON result for a successful OpenAI vision call', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                significant: true,
                description: 'Layout shifted significantly',
                regions: ['header', 'nav'],
              }),
            },
          },
        ],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, openAiConfig);

    expect(result.significant).toBe(true);
    expect(result.description).toBe('Layout shifted significantly');
    expect(result.regions).toEqual(['header', 'nav']);
  });

  it('returns parsed JSON result for a successful Google vision call', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                significant: false,
                description: 'Minor color difference only',
                regions: [],
              }),
            },
          },
        ],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, googleConfig);

    expect(result.significant).toBe(false);
    expect(result.description).toBe('Minor color difference only');
    expect(result.regions).toEqual([]);
  });

  it('returns graceful fallback when AI returns malformed JSON', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'I cannot determine the differences. The images look different.',
            },
          },
        ],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, openAiConfig);

    expect(result.significant).toBe(false);
    expect(typeof result.description).toBe('string');
    expect(result.description.length).toBeGreaterThan(0);
    expect(result.regions).toEqual([]);
  });

  it('re-throws when fetch throws a network error', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockRejectedValueOnce(new Error('Network connection failed'));

    await expect(analyzeVisionDiff(expectedPath, actualPath, openAiConfig)).rejects.toThrow(
      'Network connection failed',
    );
  });

  it('throws when fetch returns a non-OK status', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    await expect(analyzeVisionDiff(expectedPath, actualPath, openAiConfig)).rejects.toThrow(
      /Vision API error: 429/,
    );
  });

  it('throws for an unsupported provider', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    const unsupportedConfig: AiProviderConfig = {
      provider: 'anthropic',
      model: 'claude-3-opus-20240229',
      apiKey: 'test-key',
    };

    await expect(analyzeVisionDiff(expectedPath, actualPath, unsupportedConfig)).rejects.toThrow(
      /does not support vision/,
    );
  });

  it('sends request to custom baseUrl for OpenAI', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{ "significant": false, "description": "ok", "regions": [] }' } }],
      }),
    });

    const configWithBaseUrl: AiProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      baseUrl: 'https://custom.openai.proxy.example.com',
    };

    await analyzeVisionDiff(expectedPath, actualPath, configWithBaseUrl);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.openai.proxy.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handles JSON with non-boolean significant field — defaults to false', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                significant: 'yes',  // string, not boolean
                description: 'Some change',
                regions: ['nav'],
              }),
            },
          },
        ],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, openAiConfig);

    expect(result.significant).toBe(false); // defaults to false (conservative)
    expect(result.description).toBe('Some change');
    expect(result.regions).toEqual(['nav']);
  });

  it('handles JSON with non-string description field — falls back to raw text', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                significant: false,
                description: 42,  // number, not string
                regions: [],
              }),
            },
          },
        ],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, openAiConfig);

    // description falls back to raw text content
    expect(typeof result.description).toBe('string');
  });

  it('handles JSON with non-array regions field — defaults to empty array', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                significant: true,
                description: 'Layout broken',
                regions: 'header',  // string, not array
              }),
            },
          },
        ],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, openAiConfig);

    expect(result.regions).toEqual([]);
  });

  it('handles empty choices response gracefully', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [],
      }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, openAiConfig);

    // Empty text → parseVisionResponse fails JSON.parse → fallback (conservative: false)
    expect(result.significant).toBe(false);
    expect(result.regions).toEqual([]);
  });

  it('throws when Google returns a non-OK status', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(analyzeVisionDiff(expectedPath, actualPath, googleConfig)).rejects.toThrow(
      /Vision API error: 503/,
    );
  });

  it('handles Google provider returning empty choices array — graceful fallback', async () => {
    const expectedPath = writeTmpPng('expected.png');
    const actualPath = writeTmpPng('actual.png');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });

    const result = await analyzeVisionDiff(expectedPath, actualPath, googleConfig);

    expect(result.significant).toBe(false);
    expect(result.regions).toEqual([]);
  });
});
