import { isIP } from 'node:net';
import { usage } from './errors.js';

/**
 * Where the CLI talks to, and with what. Read from the environment so a token never appears
 * in a command line, a shell history or a process listing:
 *
 * - `AUTOMATE_URL` — the install's origin. `https://` anywhere; `http://` only to a loopback
 *   host (`localhost`, `127.0.0.0/8`, `::1`), because the token would cross the network in
 *   the clear.
 * - `AUTOMATE_TOKEN` — an `amt_` access token: `uploader` pinned to the project for CI.
 * - `AUTOMATE_PROJECT` — the project id, unless `--project` names it.
 */
export interface Target {
  origin: URL;
  token: string;
  project: string;
}

/**
 * Whether a host keeps the request on this machine.
 *
 * The same answer as `isLoopbackBind` (`@automate/config`), which the MCP stdio proxy uses:
 * `localhost`, `127.0.0.0/8` (also as an IPv4-mapped `::ffff:127.x.x.x`), and `::1` in any
 * spelling. The CLI ships with no runtime dependency, so it cannot import that function;
 * `units.test.ts` holds the two to the same answer over a table of hosts instead.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  if (host === 'localhost') return true;
  const plain = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(host)?.[1] ?? host;
  if (isIP(plain) === 4) return plain.split('.')[0] === '127';
  // The WHATWG parser writes every spelling of an IPv6 address one way.
  return isIP(plain) === 6 && new URL(`http://[${plain}]/`).hostname === '[::1]';
}

const PROJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function resolveTarget(
  env: Readonly<Record<string, string | undefined>>,
  projectFlag: string | undefined,
): Target {
  const raw = env['AUTOMATE_URL']?.trim() ?? '';
  const token = env['AUTOMATE_TOKEN']?.trim() ?? '';
  const project = (projectFlag ?? env['AUTOMATE_PROJECT'] ?? '').trim();
  if (raw === '')
    throw usage('Set AUTOMATE_URL to the AutoMate origin, e.g. https://automate.example.com');
  if (!token.startsWith('amt_')) throw usage('Set AUTOMATE_TOKEN to an amt_ access token.');
  if (!PROJECT.test(project)) {
    throw usage('Name the project: --project <id> or AUTOMATE_PROJECT, its id from the dashboard.');
  }
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw usage(`AUTOMATE_URL is not a URL: ${raw}`);
  }
  if (origin.username !== '' || origin.password !== '') {
    throw usage('AUTOMATE_URL must not carry credentials; the token goes in AUTOMATE_TOKEN.');
  }
  const plainAllowed = origin.protocol === 'http:' && isLoopbackHost(origin.hostname);
  if (origin.protocol !== 'https:' && !plainAllowed) {
    throw usage(
      `Refusing ${origin.protocol}//${origin.host}: use https://, or http:// only to a loopback host, because the token would cross the network in the clear.`,
    );
  }
  return { origin, token, project };
}

/** `/api/v1/projects/<id><suffix>`, with the id encoded. */
export function projectUrl(
  target: Target,
  suffix: string,
  query: Record<string, string | undefined> = {},
): URL {
  const url = new URL(
    `/api/v1/projects/${encodeURIComponent(target.project)}${suffix}`,
    target.origin,
  );
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url;
}
