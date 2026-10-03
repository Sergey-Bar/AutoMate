import { z } from 'zod/v4';
import {
  TuiCommandSchema,
  TuiViewSchema,
  type TuiCommand,
  type TuiView,
} from '@automate/shared-contracts';

/**
 * The API client, as a port.
 *
 * ## The TUI talks to the API and to nothing else
 *
 * No filesystem access, no child processes, no database. Every fact it renders came
 * from a response, and every action it offers is one of the twelve names in
 * `TUI_COMMANDS`. That is the whole reason a terminal can be handed a repository
 * path: it is not a shell, and there is no code path that could make it one.
 *
 * The port exists so the render logic is testable without a server. It is one
 * interface rather than twelve because a TUI that builds a URL by string
 * concatenation is a TUI with one more place a path can be wrong.
 */
export interface TuiApi {
  /** The one call. `command` is a name from the enum, never an executable. */
  send(command: TuiCommand): Promise<TuiView>;
}

/**
 * The transport over HTTP.
 *
 * The request body is the parsed command, and the response is parsed as
 * `TuiViewSchema` before anything renders — so a server that grows a field cannot
 * push an unvalidated shape into a terminal, and a server that omits the limiter
 * fails here rather than rendering a bare total.
 */
export class HttpTuiApi implements TuiApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly token?: string,
  ) {}

  async send(command: TuiCommand): Promise<TuiView> {
    const parsed = TuiCommandSchema.parse(command);
    const response = await this.fetchImpl(new URL(routeFor(parsed), this.baseUrl), {
      method:
        parsed.command.endsWith('.add') ||
        parsed.command.endsWith('.start') ||
        parsed.command.endsWith('.stop') ||
        parsed.command === 'copilot.ask'
          ? 'POST'
          : 'GET',
      headers: {
        'content-type': 'application/json',
        // Sent only when a token exists. The TUI is not the auth boundary; the API
        // is, and this is the credential an operator already has.
        ...(this.token === undefined ? {} : { authorization: `Bearer ${this.token}` }),
      },
      ...(method(parsed) === 'GET' ? {} : { body: JSON.stringify(parsed) }),
    });
    if (!response.ok) {
      // The server's own error shape, not a synthesised one. A terminal that
      // renders "request failed (500)" for a 409 the API explained in words is
      // hiding the only sentence that would have helped.
      const detail = await response.text();
      throw new TuiError(response.status, detail);
    }
    return TuiViewSchema.parse(await response.json());
  }
}

export class TuiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`API answered ${String(status)}`);
    this.name = 'TuiError';
  }
}

function method(command: TuiCommand): 'GET' | 'POST' {
  return MUTATING.has(command.command) ? 'POST' : 'GET';
}

/** The commands that change state. Everything else is a read. */
const MUTATING: ReadonlySet<string> = new Set(['project.add', 'run.start', 'run.stop']);

/**
 * The URL for a command, in one place.
 *
 * `encodeURIComponent` on every interpolated value. A project id is a uuid today and
 * a slug tomorrow, and a terminal that pastes one in should not be able to construct
 * a path with it.
 */
export function routeFor(command: TuiCommand): string {
  const projectId = command.projectId ?? '';
  switch (command.command) {
    case 'projects.list':
      return '/api/v1/projects';
    case 'project.add':
      return '/api/v1/projects';
    case 'project.get':
      return `/api/v1/projects/${encodeURIComponent(projectId)}`;
    case 'commands.list':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/commands`;
    case 'run.start':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/run.start`;
    case 'run.stop':
      return `/api/v1/runs/${encodeURIComponent(command.runId ?? '')}/stop`;
    case 'score.get':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/qa/score`;
    case 'gaps.get':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/qa/gaps`;
    case 'flaky.get':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/qa/flaky`;
    case 'hollow.get':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/qa/hollow`;
    case 'structure.get':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/qa/structure`;
    case 'copilot.ask':
      return `/api/v1/projects/${encodeURIComponent(projectId)}/copilot/answer`;
  }
}

/**
 * The score matrix, as rows.
 *
 * A 6×3 grid does not fit in a terminal, and a truncated grid reads as a short one.
 * So the matrix is rendered **row by row** — one line per category, three columns —
 * and the total is rendered on its own line **with the row that capped it**, because
 * the total alone is undiagnosable.
 */
export function scoreView(view: TuiView): string[] {
  const total = view.total === undefined ? '' : ` ${view.total.toFixed(1)}/100`;
  const capped = view.cappedBy === undefined ? '' : ` — capped by ${view.cappedBy}`;
  const lines = [`Score${total}${capped}`];
  for (const category of [
    'unit',
    'integration',
    'e2e',
    'performance',
    'security',
    'pyramid-shape',
  ]) {
    const group = view.rows.filter((row) => row.row === category);
    if (group.length === 0) continue;
    lines.push(`  ${category.padEnd(14)}${group.map((row) => row.detail.padStart(7)).join('')}`);
  }
  return lines;
}

/**
 * Formats a gap queue, one line each.
 *
 * **Sorted best-value-first by the server, not re-sorted here.** A terminal that
 * re-sorts is a second place the order is decided, and the two would disagree the
 * first time the server's ranking changed.
 */
export function gapView(view: TuiView): string[] {
  return view.rows.map((row) => `  ${row.title}  ${row.detail}`);
}

/**
 * Rejects anything that is not a registered command before it can reach the client.
 *
 * Belt and braces on purpose: the transport parses too, and this is the layer a
 * key handler talks to. A key handler that constructs its own object literal is the
 * most likely place for a typo like `argv:` to appear, and the cheapest place to
 * catch it.
 */
export function commandFor(input: unknown): TuiCommand {
  return TuiCommandSchema.parse(input);
}

export const tuiCommandSchema = TuiCommandSchema;
export type { TuiView };
void z;
