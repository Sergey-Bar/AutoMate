import { describe, expect, it } from 'vitest';
import {
  TUI_COMMANDS,
  TUI_COMMAND_REQUIREMENTS,
  type TuiCommand,
} from '@automate/shared-contracts';
import { HttpTuiApi, routeFor, scoreView } from './api.js';

/**
 * The request each command makes, asserted from the outside: the verb, the URL and the body
 * that actually reach `fetch`.
 */

const EMPTY_VIEW = { command: 'projects.list', rows: [], selected: [] };

function capture() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(EMPTY_VIEW), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/** A command carrying a plausible value for every field its requirement names. */
function commandWithFields(name: (typeof TUI_COMMANDS)[number]): TuiCommand {
  const fields: Record<string, string> = { command: name };
  for (const field of TUI_COMMAND_REQUIREMENTS[name].fields) fields[field] = `${field}-value`;
  return fields as unknown as TuiCommand;
}

describe('the verb and the body agree for every command', () => {
  it.each(TUI_COMMANDS.map((name) => [name]))(
    '%s: a request that is not a GET carries its command as a body, and a GET carries none',
    async (name) => {
      const { calls, impl } = capture();
      await new HttpTuiApi('http://api.test', impl).send(commandWithFields(name));
      const init = calls[0]?.init ?? {};
      if (init.method === 'GET') {
        expect(init.body, `${name} is a GET and must not carry a body`).toBeUndefined();
      } else {
        expect(init.method).toBe('POST');
        // A POST with no body reaches the API as an empty object, which it rejects.
        expect(init.body, `${name} is a POST and must carry its arguments`).toBeDefined();
        expect(JSON.parse(String(init.body)).command).toBe(name);
      }
    },
  );

  it('sends the question the operator typed to the copilot', async () => {
    const { calls, impl } = capture();
    await new HttpTuiApi('http://api.test', impl).send({
      command: 'copilot.ask',
      projectId: 'p1',
      question: 'what is hollow?',
    });
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body)).question).toBe('what is hollow?');
  });

  it('sends exactly the commands that change state as POST', async () => {
    const posted: string[] = [];
    for (const name of TUI_COMMANDS) {
      const { calls, impl } = capture();
      await new HttpTuiApi('http://api.test', impl).send(commandWithFields(name));
      if (calls[0]?.init.method === 'POST') posted.push(name);
    }
    expect(posted.sort()).toEqual(['copilot.ask', 'project.add', 'run.start', 'run.stop']);
  });
});

describe('routes for commands whose identifiers are absent', () => {
  it('builds an empty segment rather than the string "undefined"', () => {
    expect(routeFor({ command: 'project.get' } as unknown as TuiCommand)).toBe('/api/v1/projects/');
    expect(routeFor({ command: 'run.stop' } as unknown as TuiCommand)).toBe('/api/v1/runs//stop');
  });

  it('escapes a run id as it escapes a project id', () => {
    expect(routeFor({ command: 'run.stop', runId: 'a/b?c' } as unknown as TuiCommand)).toBe(
      '/api/v1/runs/a%2Fb%3Fc/stop',
    );
  });
});

describe('the score header with parts of it missing', () => {
  const row = { key: 'unit', row: 'unit', title: 'unit / backend', detail: '0.84' } as const;

  it('prints the bare heading when the server sent neither a total nor a limiter', () => {
    expect(scoreView({ command: 'score.get', rows: [], selected: [] })).toEqual(['Score']);
  });

  it('prints a total without inventing a limiter', () => {
    const [heading] = scoreView({ command: 'score.get', total: 41.26, rows: [row], selected: [] });
    expect(heading).toBe('Score 41.3/100');
  });

  it('leaves out a category with no rows rather than printing an empty line for it', () => {
    const lines = scoreView({ command: 'score.get', total: 10, rows: [row], selected: [] });
    expect(lines).toHaveLength(2);
    expect(lines[1]?.trim().startsWith('unit')).toBe(true);
  });
});
