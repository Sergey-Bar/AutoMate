import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import {
  runResultCallbackSchema,
  serviceHealthStatusSchema,
  triggerRunRequestSchema,
} from './schemas/index.js';

const ajv = new Ajv({ allErrors: true, strict: true });

describe('shared contracts schemas', () => {
  it('validates TriggerRunRequest payload', () => {
    const validate = ajv.compile(triggerRunRequestSchema);
    const valid = validate({
      specCode: 'await page.goto("https://example.com")',
      specFileName: 'login.spec.ts',
      baseUrl: 'https://example.com',
      browser: 'chromium',
      metadata: { suite: 'smoke' },
    });

    expect(valid).toBe(true);
  });

  it('rejects invalid TriggerRunRequest payload with missing specFileName', () => {
    const validate = ajv.compile(triggerRunRequestSchema);
    const valid = validate({
      specCode: 'await page.goto("https://example.com")',
    });

    expect(valid).toBe(false);
    expect(validate.errors?.[0]).toMatchObject({
      keyword: 'required',
      message: "must have required property 'specFileName'",
    });
  });

  it('validates RunResultCallback payload', () => {
    const validate = ajv.compile(runResultCallbackSchema);
    const valid = validate({
      runId: 'run_123',
      status: 'completed',
      duration: 1234,
      total: 10,
      passed: 9,
      failed: 1,
      skipped: 0,
      errors: [
        {
          testName: 'login flow',
          message: 'timeout',
          stack: 'Error: timeout',
        },
      ],
      triggeredBy: 'automation-bot',
      triggeredAt: '2026-05-04T10:00:00.000Z',
      completedAt: '2026-05-04T10:00:01.234Z',
    });

    expect(valid).toBe(true);
  });

  it('validates ServiceHealthStatus payload', () => {
    const validate = ajv.compile(serviceHealthStatusSchema);
    const valid = validate({
      status: 'healthy',
      version: '1.2.3',
      uptime: 98765,
      checks: {
        database: { status: 'ok', message: 'connected' },
        queue: { status: 'error' },
      },
    });

    expect(valid).toBe(true);
  });
});
