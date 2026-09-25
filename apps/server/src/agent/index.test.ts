import { describe, expect, it } from 'vitest';
import * as agentIndex from './index.js';

describe('agent/index barrel', () => {
  it('re-exports createMemoryRepository from memory module', () => {
    expect(agentIndex.createMemoryRepository).toBeTypeOf('function');
  });

  it('re-exports createOrchestrator from orchestrator module', () => {
    expect(agentIndex.createOrchestrator).toBeTypeOf('function');
  });

  it('re-exports runAgentOnce from orchestrator module', () => {
    expect(agentIndex.runAgentOnce).toBeTypeOf('function');
  });

  it('re-exports buildPlannerInput from planner module', () => {
    expect(agentIndex.buildPlannerInput).toBeTypeOf('function');
  });
});
