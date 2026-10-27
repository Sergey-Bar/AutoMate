import { isIP } from 'node:net';

/**
 * Whether a host keeps the request on this machine: `localhost`, `127.0.0.0/8` (also as an
 * IPv4-mapped `::ffff:127.x.x.x`), and `::1` in any spelling.
 *
 * The same answer as `isLoopbackBind` in `@automate/config` and `isLoopbackHost` in the
 * CLI. The reporter ships with no runtime dependency, so it cannot import either;
 * `target.test.ts` holds it to `isLoopbackBind` over a table of hosts instead.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  if (host === 'localhost') return true;
  const plain = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(host)?.[1] ?? host;
  if (isIP(plain) === 4) return plain.split('.')[0] === '127';
  return isIP(plain) === 6 && new URL(`http://[${plain}]/`).hostname === '[::1]';
}

/**
 * The origin to send to, or the sentence saying why nothing will be sent.
 *
 * `https://` anywhere; `http://` only to a loopback host, because the reporter secret and
 * every failure message would otherwise cross the network in the clear.
 */
export function resolveOrigin(raw: string | undefined): { origin: URL } | { refused: string } {
  const value = raw?.trim() ?? '';
  if (value === '') return { refused: 'AUTOMATE_URL is not set; nothing is sent.' };
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return { refused: `AUTOMATE_URL is not a URL (${value}); nothing is sent.` };
  }
  if (origin.username !== '' || origin.password !== '') {
    return {
      refused:
        'AUTOMATE_URL must not carry credentials; the secret goes in AUTOMATE_REPORTER_SECRET. Nothing is sent.',
    };
  }
  const plainAllowed = origin.protocol === 'http:' && isLoopbackHost(origin.hostname);
  if (origin.protocol !== 'https:' && !plainAllowed) {
    return {
      refused: `refusing ${origin.protocol}//${origin.host}: use https://, or http:// only to a loopback host. Nothing is sent.`,
    };
  }
  return { origin };
}
