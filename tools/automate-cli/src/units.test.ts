import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLoopbackBind } from '@automate/config';
import {
  AGENT_CONFIG_PATHS as SERVER_PATHS,
  isAgentConfigPath as serverMatches,
} from '@automate/projects';
import {
  MAX_AGENT_CONFIG_FILE_BYTES as SERVER_FILE_BYTES,
  MAX_AGENT_CONFIG_FILES as SERVER_FILES,
} from '@automate/shared-contracts';
import {
  AGENT_CONFIG_PATHS,
  MAX_AGENT_CONFIG_FILE_BYTES,
  MAX_AGENT_CONFIG_FILES,
  isAgentConfigPath,
} from './agent-config.js';
import { CliError, EXIT } from './errors.js';
import { send } from './http.js';
import { isLoopbackHost, projectUrl, resolveTarget } from './target.js';

describe('one list of agent-config paths, held twice', () => {
  it('is the server’s list, and the server’s limits', () => {
    expect([...AGENT_CONFIG_PATHS]).toEqual([...SERVER_PATHS]);
    expect(MAX_AGENT_CONFIG_FILES).toBe(SERVER_FILES);
    expect(MAX_AGENT_CONFIG_FILE_BYTES).toBe(SERVER_FILE_BYTES);
  });

  it.each([
    'AGENTS.md',
    'packages/a/AGENTS.md',
    'claude.md',
    '.cursor/rules/a/b/c.mdc',
    '.cursor/rules/c.mdc',
    '.github/instructions/x.instructions.md',
    '.kiro/settings/mcp.json',
    'deep/dir/claude_desktop_config.json',
    './.mcp.json',
    'skills\\x\\SKILL.md',
    'README.md',
    '.cursor/rules/c.md',
    '.claude/agents/sub/x.md',
    'AGENTS.md.bak',
  ])('matches %s exactly when the server does', (candidate) => {
    expect(isAgentConfigPath(candidate)).toBe(serverMatches(candidate));
  });
  it('is the composite action’s list too, as the bash patterns it matches with', () => {
    const action = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../.github/actions/automate-health/action.yml',
      ),
      'utf8',
    );
    const block =
      action.split('# agent-config-patterns:begin')[1]?.split('# agent-config-patterns:end')[0] ??
      '';
    const inAction = [...block.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
    const expected = AGENT_CONFIG_PATHS.flatMap((pattern) =>
      pattern.startsWith('**/')
        ? [pattern.slice(3), `*/${pattern.slice(3)}`]
        : [pattern.replace('/**/', '/')],
    );
    expect(inAction.length).toBeGreaterThan(20);
    expect(new Set(inAction)).toEqual(new Set(expected));
  });
});

describe('isLoopbackHost', () => {
  it.each([
    ['localhost', true],
    ['LOCALHOST', true],
    ['127.0.0.1', true],
    ['127.10.0.3', true],
    ['[::1]', true],
    ['::1', true],
    ['0:0:0:0:0:0:0:1', true],
    ['::ffff:127.0.0.1', true],
    ['[::ffff:127.0.0.1]', true],
    ['128.0.0.1', false],
    ['10.0.0.1', false],
    ['localhost.example.com', false],
    ['::2', false],
    ['127.evil.example', false],
  ])('%s → %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });

  /** Every host here, through both definitions of "loopback", must get the same answer. */
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

  it('is the same answer as @automate/config isLoopbackBind, the MCP proxy\u2019s, on every host', () => {
    for (const host of HOSTS) {
      expect(isLoopbackHost(host), host).toBe(isLoopbackBind(host));
    }
  });

  /** The composite action's bash check, as the ERE it matches the lowercased host with. */
  function actionLoopback(): RegExp {
    const action = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../.github/actions/automate-health/action.yml',
      ),
      'utf8',
    );
    const block =
      action.split('# loopback-pattern:begin')[1]?.split('# loopback-pattern:end')[0] ?? '';
    const octet = /octet='([^']+)'/u.exec(block)?.[1] ?? 'unset';
    const loopback = /loopback="([^"]+)"/u.exec(block)?.[1] ?? 'unset';
    return new RegExp(loopback.replaceAll('${octet}', octet), 'u');
  }

  it('is never more permissive in the composite action than in the CLI, and refuses 127.evil.example', () => {
    const pattern = actionLoopback();
    expect(pattern.test('127.evil.example')).toBe(false);
    expect(pattern.test('127.0.0.1.evil.example')).toBe(false);
    for (const host of ['localhost', '127.0.0.1', '127.255.255.255', '::1']) {
      expect(pattern.test(host), host).toBe(true);
    }
    for (const host of HOSTS.map((entry) => entry.trim().toLowerCase())) {
      // The action admits only the plain forms; whatever it admits, the CLI admits too.
      if (pattern.test(host)) expect(isLoopbackHost(host), host).toBe(true);
      if (!isLoopbackHost(host)) expect(pattern.test(host), host).toBe(false);
    }
  });
});

describe('the request', () => {
  const target = resolveTarget(
    {
      AUTOMATE_URL: 'https://automate.example',
      AUTOMATE_TOKEN: 'amt_x',
      AUTOMATE_PROJECT: '11111111-1111-4111-8111-111111111111',
    },
    undefined,
  );

  it('builds project paths with the id encoded and empty query values dropped', () => {
    expect(
      projectUrl(target, '/health/reports', { format: 'sarif', branch: '', commit: undefined })
        .href,
    ).toBe(
      'https://automate.example/api/v1/projects/11111111-1111-4111-8111-111111111111/health/reports?format=sarif',
    );
  });

  it('never sends the token to another origin, and never follows a redirect', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: URL, init: RequestInit) => {
      calls.push(init);
      return new Response('plain text', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      send(fetchImpl, target, new URL('https://elsewhere.example/x'), { method: 'GET' }),
    ).rejects.toThrow(CliError);
    expect(calls).toHaveLength(0);
    expect(await send(fetchImpl, target, projectUrl(target, '/x'), { method: 'GET' })).toBe(
      'plain text',
    );
    expect(calls[0]?.redirect).toBe('error');
  });

  it('maps a thrown non-Error to refused', async () => {
    const fetchImpl = (async () => {
      throw 'socket closed';
    }) as unknown as typeof fetch;
    await expect(
      send(fetchImpl, target, projectUrl(target, '/x'), { method: 'GET' }),
    ).rejects.toMatchObject({
      exitCode: EXIT.refused,
      message: 'Could not reach https://automate.example: socket closed',
    });
  });
});

describe('an install behind Cloudflare Access', () => {
  const base = {
    AUTOMATE_URL: 'https://automate.example',
    AUTOMATE_TOKEN: 'amt_x',
    AUTOMATE_PROJECT: '11111111-1111-4111-8111-111111111111',
  };
  // Assembled at runtime: a service token secret is a credential.
  const secret = ['cf', 'secret', String(Date.now())].join('-');

  it('sends the Access service token beside the access token, to the same origin only', async () => {
    const target = resolveTarget(
      {
        ...base,
        AUTOMATE_CF_ACCESS_CLIENT_ID: 'ci.access',
        AUTOMATE_CF_ACCESS_CLIENT_SECRET: secret,
      },
      undefined,
    );
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: URL, init: RequestInit) => {
      calls.push(init);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await send(fetchImpl, target, projectUrl(target, '/x'), { method: 'GET' });
    expect(calls[0]?.headers).toMatchObject({
      authorization: 'Bearer amt_x',
      'cf-access-client-id': 'ci.access',
      'cf-access-client-secret': secret,
    });
  });

  it('sends no Access headers when none are configured', async () => {
    const target = resolveTarget(base, undefined);
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: URL, init: RequestInit) => {
      calls.push(init);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await send(fetchImpl, target, projectUrl(target, '/x'), { method: 'GET' });
    expect(Object.keys(calls[0]?.headers ?? {})).not.toContain('cf-access-client-id');
  });

  it('refuses half a service token, naming the missing half', () => {
    expect(() => resolveTarget({ ...base, AUTOMATE_CF_ACCESS_CLIENT_ID: 'ci' }, undefined)).toThrow(
      /AUTOMATE_CF_ACCESS_CLIENT_SECRET/u,
    );
    expect(() =>
      resolveTarget({ ...base, AUTOMATE_CF_ACCESS_CLIENT_SECRET: secret }, undefined),
    ).toThrow(/AUTOMATE_CF_ACCESS_CLIENT_ID/u);
  });
});
