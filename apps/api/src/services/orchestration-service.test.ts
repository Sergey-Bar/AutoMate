import { describe, expect, it } from 'vitest';
import { OrchestrationService } from './orchestration-service.js';

const definition = { workspaceId: 'workspace-1', name: 'Playwright', tool: 'playwright' as const, toolVersion: '1.63.0', imageDigest: 'a'.repeat(64), input: {}, timeoutMs: 1000, maxAttempts: 1, requiredCapabilities: ['playwright'] };

describe('OrchestrationService', () => {
  it('creates, enqueues, lists, and cancels jobs', () => {
    const service = new OrchestrationService();
    const automation = service.createAutomation(definition);
    expect(service.listAutomations()).toHaveLength(1);
    const job = service.enqueue(automation.id);
    expect(service.listJobs()[0]?.executionId).toBe(job.executionId);
    expect(service.cancel(job.executionId).state).toBe('cancelled');
    expect(() => service.enqueue('missing')).toThrow();
    expect(() => service.cancel('missing')).toThrow();
  });
});
