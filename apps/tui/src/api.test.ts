import { describe, expect, it } from 'vitest';
import { HttpTuiApi, TuiError, commandFor, gapView, routeFor, scoreView } from './api.js';
import { TUI_COMMANDS, type TuiView } from '@automate/shared-contracts';

/**
 * The terminal, with the network and the screen both faked.
 *
 * ## The properties under test are all about the **surface**, not the pixels
 *
 * Where a request goes, what it is allowed to carry, and what a reader is shown
 * beside a number. A terminal that renders correctly and can also be talked into
 * running something is not a terminal with a bug; it is an RCE surface, and the
 * only test that catches that is one about the request the key handler can build.
 */

const view = (overrides: Partial<TuiView> = {}): TuiView => ({
  command: 'score.get',
  projectId: 'project-1',
  total: 62,
  cappedBy: 'security',
  rows: [
    { key: 'unit', row: 'unit', title: 'unit / backend', detail: '0.84' },
    { key: 'unit-frontend', row: 'unit', title: 'unit / frontend', detail: '0.00' },
    { key: 'security', row: 'security', title: 'security / backend', detail: '0.00' },
  ],
  selected: [],
  ...overrides,
});

/** A `fetch` that records what it was asked for. */
function recorder(response: { status?: number; body: unknown } = { body: view() }) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('every command routes to exactly one documented endpoint', () => {
  it('covers all twelve names', () => {
    expect(TUI_COMMANDS).toHaveLength(12);
  });

  it('builds a URL for every command, so none can reach an unnamed route', () => {
    for (const command of TUI_COMMANDS) {
      const path = routeFor({ command, projectId: 'project-1', runId: 'run-1' } as never);
      expect(path.startsWith('/api/v1/'), `${command} → ${path}`).toBe(true);
      expect(path.includes('undefined'), `${command} → ${path}`).toBe(false);
    }
  });

  it('escapes every interpolated value', () => {
    // A project id is a uuid today and a slug tomorrow. A terminal that pastes one
    // in must not be able to construct a path with it.
    expect(routeFor({ command: 'project.get', projectId: '../../admin' } as never)).toBe(
      '/api/v1/projects/..%2F..%2Fadmin',
    );
  });

  it('sends a read as GET and a mutation as POST', async () => {
    const { calls, impl } = recorder();
    const api = new HttpTuiApi('http://api.test', impl);
    await api.send({ command: 'score.get', projectId: 'project-1' });
    expect(calls[0]?.init?.method).toBe('GET');

    await api.send({
      command: 'run.start',
      projectId: 'project-1',
      commandId: 'node.test',
      idempotencyKey: 'k1',
    });
    expect(calls[1]?.init?.method).toBe('POST');
    // And the body carries a **command id**, never an executable.
    expect(JSON.parse(String(calls[1]?.init?.body)).commandId).toBe('node.test');
    expect(String(calls[1]?.init?.body)).not.toMatch(/argv|shell/iu);
  });

  it('rejects a command that is not in the registry before any request is made', async () => {
    const { calls, impl } = recorder();
    const api = new HttpTuiApi('http://api.test', impl);
    // `commandFor` is synchronous — it is the layer a key handler talks to.
    expect(() => commandFor({ command: 'exec', argv: ['rm', '-rf', '/'] })).toThrow();
    // `send` is async, so its rejection is a promise. Asserting it with a
    // synchronous `toThrow` would leave the rejection unhandled and fail the run
    // with an error that names neither this test nor the cause.
    await expect(api.send({ command: 'run.shell' } as never)).rejects.toThrow();
    // And nothing was sent: the parse happens before the fetch.
    expect(calls).toHaveLength(0);
  });
});

describe('the transport will not render an unvalidated payload', () => {
  it('refuses a view carrying a total with no limiter', async () => {
    // The same clause the schema carries, asserted at the boundary the terminal
    // actually crosses. A server that grows the field wrongly fails here rather
    // than painting a bare number.
    const { impl } = recorder({
      body: { command: 'score.get', projectId: 'p', total: 62, rows: [] },
    });
    const api = new HttpTuiApi('http://api.test', impl);
    await expect(api.send({ command: 'score.get', projectId: 'p' })).rejects.toThrow();
  });

  it("surfaces the server's own error body rather than a synthesised one", async () => {
    const impl = (async () =>
      new Response('{"error":{"message":"a project with that slug is already registered"}}', {
        status: 409,
      })) as unknown as typeof fetch;
    const api = new HttpTuiApi('http://api.test', impl);
    const failure = await api.send({ command: 'projects.list' }).catch((error: unknown) => error);
    // A terminal that prints "request failed" for a 409 the API explained in words
    // is hiding the only sentence that would have helped.
    expect(failure).toBeInstanceOf(TuiError);
    expect((failure as TuiError).status).toBe(409);
    expect((failure as TuiError).detail).toContain('already registered');
  });

  it('sends the bearer token only when one exists', async () => {
    const { calls, impl } = recorder();
    await new HttpTuiApi('http://api.test', impl).send({ command: 'projects.list' });
    expect(calls[0]?.init?.headers).not.toHaveProperty('authorization');

    const withToken = recorder();
    await new HttpTuiApi('http://api.test', withToken.impl, 'secret').send({
      command: 'projects.list',
    });
    expect((withToken.calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer secret',
    );
  });
});

describe('the score is never rendered as a bare number', () => {
  const lines = scoreView(view());

  it('puts the limiter on the same line as the total', () => {
    // A weighted geometric total cannot be diluted by a zero, and for exactly that
    // reason it cannot be diagnosed either. The number and the reason it is low are
    // one line, so a reader cannot see the first without the second.
    expect(lines[0]).toContain('62.0/100');
    expect(lines[0]).toContain('capped by security');
  });

  it('groups the matrix by row, so a truncated terminal does not hide a category', () => {
    expect(lines.some((line) => line.includes('unit'))).toBe(true);
    expect(lines.some((line) => line.includes('security'))).toBe(true);
  });

  it('renders every cell of a row on one line rather than truncating the grid', () => {
    const unitLine = lines.find((line) => line.includes('unit')) ?? '';
    expect(unitLine).toContain('0.84');
    expect(unitLine).toContain('0.00');
  });
});

describe('the gap queue keeps the order the server chose', () => {
  it('does not re-sort, because a second sorter is a second authority', () => {
    const ordered = view({
      command: 'gaps.get',
      total: undefined,
      cappedBy: undefined,
      rows: [
        { key: 'a', title: 'first', detail: '0.9' },
        { key: 'b', title: 'second', detail: '0.1' },
      ],
    });
    // Ascending by `potential` would reverse these. The server ranked them; the
    // terminal shows what it was given.
    expect(gapView(ordered).map((line) => line.trim().split(/\s+/)[0])).toEqual([
      'first',
      'second',
    ]);
  });

  it('renders an empty queue as nothing rather than as a placeholder', () => {
    expect(gapView(view({ command: 'gaps.get', rows: [] }))).toEqual([]);
  });
});
