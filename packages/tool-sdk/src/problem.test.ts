import { describe, expect, it } from 'vitest';
import { notConfigured, toAgentProblem, type ToolFailure } from './problem.js';

const failure = (overrides: Partial<ToolFailure>): ToolFailure => ({
  kind: 'tool_failure',
  code: 'AGENT_TOOL_FAILED',
  message: 'it broke',
  domain: 'load',
  action: 'run',
  attempts: 1,
  ...overrides,
});

describe('toAgentProblem', () => {
  it('renders a configuration failure as the 501 agents.ts answers today, key order included', () => {
    const problem = toAgentProblem(notConfigured('browser', 'scan'));
    expect(problem.httpStatus).toBe(501);
    expect(problem.body).toEqual({
      status: 'not_configured',
      implemented: false,
      code: 'AGENT_NOT_CONFIGURED',
      domain: 'browser',
      action: 'scan',
      message: 'browser.scan has no configured execution adapter',
    });
    expect(Object.keys(problem.body)).toEqual([
      'status',
      'implemented',
      'code',
      'domain',
      'action',
      'message',
    ]);
  });

  it('renders the two route refusals as the flat 404s agents.ts answers', () => {
    const route = toAgentProblem(
      failure({
        kind: 'invalid_input',
        code: 'AGENT_ROUTE_NOT_FOUND',
        message: 'Agent route is not implemented',
        attempts: 0,
      }),
    );
    expect(route).toEqual({
      httpStatus: 404,
      body: {
        status: 'not_implemented',
        implemented: false,
        code: 'AGENT_ROUTE_NOT_FOUND',
        message: 'Agent route is not implemented',
      },
    });
    const action = toAgentProblem(
      failure({ kind: 'invalid_input', code: 'AGENT_ACTION_NOT_FOUND', message: 'nope' }),
    );
    expect(action.httpStatus).toBe(404);
    expect(action.body['status']).toBe('not_implemented');
  });

  it('renders bad input as a 400 that names the operation', () => {
    const problem = toAgentProblem(
      failure({ kind: 'invalid_input', code: 'AGENT_INVALID_INPUT', message: 'script: required' }),
    );
    expect(problem.httpStatus).toBe(400);
    expect(problem.body).toEqual({
      status: 'invalid_input',
      implemented: true,
      code: 'AGENT_INVALID_INPUT',
      domain: 'load',
      action: 'run',
      attempts: 1,
      message: 'script: required',
    });
  });

  it('renders a retryable failure as a 503 and a tool failure as a 502', () => {
    const retryable = toAgentProblem(
      failure({ kind: 'retryable', code: 'AGENT_UNAVAILABLE', attempts: 3 }),
    );
    expect(retryable.httpStatus).toBe(503);
    expect(retryable.body).toMatchObject({ status: 'unavailable', implemented: true, attempts: 3 });
    const broken = toAgentProblem(failure({}));
    expect(broken.httpStatus).toBe(502);
    expect(broken.body).toMatchObject({ status: 'tool_failure', code: 'AGENT_TOOL_FAILED' });
  });
});

describe('notConfigured', () => {
  it('is a configuration failure with no attempts made', () => {
    expect(notConfigured('api', 'run')).toEqual({
      kind: 'configuration',
      code: 'AGENT_NOT_CONFIGURED',
      domain: 'api',
      action: 'run',
      attempts: 0,
      message: 'api.run has no configured execution adapter',
    });
  });
});
