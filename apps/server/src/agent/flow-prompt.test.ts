import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './flow-prompt.js';

describe('buildSystemPrompt', () => {
  it('includes the base Automate identity', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Automate');
  });

  it('includes flow template prompt when provided', () => {
    const prompt = buildSystemPrompt('You are a test automation expert.');
    expect(prompt).toContain('You are a test automation expert.');
  });

  it('includes tool list when provided', () => {
    const prompt = buildSystemPrompt(undefined, ['github.create_issue', 'jira.create_ticket']);
    expect(prompt).toContain('github.create_issue');
    expect(prompt).toContain('jira.create_ticket');
  });

  it('produces valid output with no args', () => {
    const prompt = buildSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('combines flow prompt and tools', () => {
    const prompt = buildSystemPrompt('Custom flow.', ['slack.send_message']);
    expect(prompt).toContain('Custom flow.');
    expect(prompt).toContain('slack.send_message');
  });

  describe('dashboard capabilities', () => {
    it('includes Dashboard section when dashboardEnabled option is true', () => {
      const prompt = buildSystemPrompt(undefined, undefined, { dashboardEnabled: true });
      expect(prompt).toContain('dashboard__triggerTestRun');
      expect(prompt).toContain('dashboard__getRunStatus');
      expect(prompt).toContain('dashboard__getRunResults');
      expect(prompt).toContain('dashboard__listRecentRuns');
      expect(prompt).toContain('Dashboard Testing Capabilities');
    });

    it('does NOT include Dashboard section when dashboardEnabled option is false', () => {
      const prompt = buildSystemPrompt(undefined, undefined, { dashboardEnabled: false });
      expect(prompt).not.toContain('dashboard__triggerTestRun');
      expect(prompt).not.toContain('Dashboard Testing Capabilities');
    });

    it('does NOT include Dashboard section when no options passed and flag defaults to off', () => {
      // Feature flag defaults to false when env var is not set
      const originalEnv = process.env.FEATURE_DASHBOARD_CONNECTOR;
      delete process.env.FEATURE_DASHBOARD_CONNECTOR;
      const prompt = buildSystemPrompt();
      process.env.FEATURE_DASHBOARD_CONNECTOR = originalEnv;
      expect(prompt).not.toContain('dashboard__triggerTestRun');
    });

    it('includes Dashboard section when env flag is set to true', () => {
      const originalEnv = process.env.FEATURE_DASHBOARD_CONNECTOR;
      process.env.FEATURE_DASHBOARD_CONNECTOR = 'true';
      const prompt = buildSystemPrompt();
      process.env.FEATURE_DASHBOARD_CONNECTOR = originalEnv;
      expect(prompt).toContain('dashboard__triggerTestRun');
    });

    it('prompt mentions remembering the Run ID for follow-up queries', () => {
      const prompt = buildSystemPrompt(undefined, undefined, { dashboardEnabled: true });
      expect(prompt).toMatch(/Run ID/i);
      expect(prompt).toMatch(/follow.up/i);
    });

    it('dashboard section appears before flow instructions when both present', () => {
      const prompt = buildSystemPrompt('Custom flow.', undefined, { dashboardEnabled: true });
      const dashboardIdx = prompt.indexOf('Dashboard Testing Capabilities');
      const flowIdx = prompt.indexOf('Custom flow.');
      expect(dashboardIdx).toBeGreaterThan(-1);
      expect(flowIdx).toBeGreaterThan(dashboardIdx);
    });
  });
});
