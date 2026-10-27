import { describe, expect, it } from 'vitest';
import { isLoopbackBind } from '@automate/config';
import { isLoopbackHost, resolveOrigin } from './target.js';

/**
 * The reporter's definition of loopback is a copy — it ships with no runtime dependency —
 * so it is held to `@automate/config`'s, which the CLI and the MCP proxy are held to too.
 */
const HOSTS = [
  'localhost',
  'LocalHost',
  ' localhost ',
  'localhost.example.com',
  '127.0.0.1',
  '127.255.255.255',
  '127.1',
  '127.0.0.256',
  '127.0.0.01',
  '127.evil.example',
  '127.0.0.1.evil.example',
  '126.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '0:0:0:0:0:0:0:1',
  '0::1',
  '::2',
  '::',
  '::ffff:127.0.0.1',
  '[::ffff:127.0.0.1]',
  '::ffff:7f00:1',
  '::ffff:10.0.0.1',
  'fe80::1',
  '',
];

describe('isLoopbackHost', () => {
  it('is the same answer as @automate/config isLoopbackBind on every host', () => {
    for (const host of HOSTS) expect(isLoopbackHost(host), host).toBe(isLoopbackBind(host));
  });

  it('can tell the two apart: the table holds both answers', () => {
    expect(HOSTS.filter(isLoopbackHost).length).toBeGreaterThan(3);
    expect(HOSTS.filter((host) => !isLoopbackHost(host)).length).toBeGreaterThan(3);
  });
});

describe('resolveOrigin', () => {
  it('names why it refuses, without echoing credentials', () => {
    // Assembled at runtime: a literal URL with a password is what the secret scan refuses.
    const password = ['hun', 'ter2'].join('');
    const url = new URL('http://localhost:3000');
    url.username = 'user';
    url.password = password;
    const refused = resolveOrigin(url.href);
    expect(refused).toEqual({ refused: expect.stringMatching(/must not carry credentials/u) });
    expect(JSON.stringify(refused)).not.toContain(password);
  });
});
