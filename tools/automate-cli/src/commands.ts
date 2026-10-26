import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectAgentConfig } from './agent-config.js';
import { optional, parseOptions, required } from './args.js';
import { CliError, EXIT, usage, type ExitCode } from './errors.js';
import { send } from './http.js';
import { projectUrl, resolveTarget, type Target } from './target.js';

export interface Io {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  fetch: typeof fetch;
  out: (line: string) => void;
  /** The clock, for a deployment's `createdAt`. */
  now: () => Date;
}

const COMMIT = /^[0-9a-f]{7,64}$/iu;
const DIGEST = /^sha256:[0-9a-f]{64}$/iu;

/** The branch and commit CI is building, from the flags or GitHub Actions' own variables. */
function branchOf(io: Io, flag: string | undefined): string | undefined {
  return (
    flag ?? io.env['AUTOMATE_BRANCH'] ?? (io.env['GITHUB_HEAD_REF'] || io.env['GITHUB_REF_NAME'])
  );
}

function commitOf(io: Io, flag: string | undefined): string | undefined {
  const commit = flag ?? io.env['AUTOMATE_COMMIT'] ?? io.env['GITHUB_SHA'];
  if (commit !== undefined && commit !== '' && !COMMIT.test(commit)) {
    throw usage(`Not a commit sha: ${commit}`);
  }
  return commit === '' ? undefined : commit;
}

function target(io: Io, parsed: { values: Map<string, string> }): Target {
  return resolveTarget(io.env, parsed.values.get('project'));
}

/** `automate upload --format <f> --file <path> [--branch --commit --digest --source-root]` */
export async function upload(argv: readonly string[], io: Io): Promise<ExitCode> {
  const parsed = parseOptions(argv, {
    values: ['project', 'format', 'file', 'branch', 'commit', 'digest', 'source-root'],
  });
  const format = required(parsed, 'format');
  const file = required(parsed, 'file');
  const digest = optional(parsed, 'digest');
  if (digest !== undefined && !DIGEST.test(digest)) throw usage('--digest is sha256:<64 hex>');
  const destination = target(io, parsed);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(path.resolve(io.cwd, file)));
  } catch {
    // A scanner that wrote nothing is not a clean scan.
    throw usage(`Report ${file} was not written; the scanner did not produce it.`);
  }
  const url = projectUrl(destination, '/health/reports', {
    format,
    branch: branchOf(io, optional(parsed, 'branch')),
    commit: commitOf(io, optional(parsed, 'commit')),
    digest,
    sourceRoot: optional(parsed, 'source-root', io.env['GITHUB_WORKSPACE']),
  });
  const result = (await send(io.fetch, destination, url, {
    method: 'POST',
    body: bytes,
    contentType: 'application/octet-stream',
  })) as { findings?: { new?: number }; grade?: { letter?: string | null } } | null;
  io.out(
    `Uploaded ${file} as ${format}: ${String(result?.findings?.new ?? 0)} new finding(s), grade ${result?.grade?.letter ?? 'incomplete'}.`,
  );
  return EXIT.ok;
}

interface GateAnswer {
  verdict?: unknown;
  reasons?: unknown;
  grade?: { letter?: string | null };
}

/** `automate gate --branch <b> --commit <sha> [--pr <n>]` — exits 1 when the gate fails. */
export async function gate(argv: readonly string[], io: Io): Promise<ExitCode> {
  const parsed = parseOptions(argv, { values: ['project', 'branch', 'commit', 'pr'] });
  const branch = branchOf(io, optional(parsed, 'branch'));
  const commit = commitOf(io, optional(parsed, 'commit'));
  if (branch === undefined || branch === '') throw usage('--branch is required');
  if (commit === undefined) throw usage('--commit is required');
  const pr = optional(parsed, 'pr');
  const pullRequest = pr === undefined ? undefined : Number(pr);
  if (pullRequest !== undefined && !(Number.isInteger(pullRequest) && pullRequest > 0)) {
    throw usage(`--pr is a pull request number: ${String(pr)}`);
  }
  const destination = target(io, parsed);
  const answer = (await send(
    io.fetch,
    destination,
    projectUrl(destination, '/health/gate/report'),
    {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        branch,
        commit,
        ...(pullRequest === undefined ? {} : { pullRequest }),
      }),
    },
  )) as GateAnswer | null;
  const reasons = Array.isArray(answer?.reasons) ? answer.reasons.map(String) : [];
  if (answer?.verdict !== 'passed' && answer?.verdict !== 'failed') {
    throw new CliError('The server answered without a gate verdict.', EXIT.refused);
  }
  io.out(`Gate ${answer.verdict} on ${branch} — grade ${answer.grade?.letter ?? 'incomplete'}.`);
  for (const reason of reasons) io.out(`- ${reason}`);
  return answer.verdict === 'passed' ? EXIT.ok : EXIT.gateFailed;
}

/** `automate deploy --environment <e> --status success|failure [--sha --id --url --created-at --rollback --hotfix]` */
export async function deploy(argv: readonly string[], io: Io): Promise<ExitCode> {
  const parsed = parseOptions(argv, {
    values: ['project', 'environment', 'status', 'sha', 'id', 'url', 'created-at'],
    switches: ['rollback', 'hotfix', 'unplanned'],
  });
  const environment = required(parsed, 'environment');
  const status = required(parsed, 'status');
  if (status !== 'success' && status !== 'failure') throw usage('--status is success or failure');
  const sha = commitOf(io, optional(parsed, 'sha'));
  const createdAt = optional(parsed, 'created-at') ?? io.now().toISOString();
  if (Number.isNaN(Date.parse(createdAt)))
    throw usage(`--created-at is an ISO-8601 time: ${createdAt}`);
  const externalId =
    optional(parsed, 'id') ??
    (io.env['GITHUB_RUN_ID'] === undefined
      ? `${environment}-${sha ?? createdAt}`
      : `${environment}-${io.env['GITHUB_RUN_ID']}-${io.env['GITHUB_RUN_ATTEMPT'] ?? '1'}`);
  const body = {
    externalId: externalId.slice(0, 200),
    environment,
    status,
    createdAt,
    ...(sha === undefined ? {} : { sha }),
    ...(optional(parsed, 'url') === undefined ? {} : { url: optional(parsed, 'url') }),
    ...Object.fromEntries([...parsed.switches].map((name) => [name, true])),
  };
  const destination = target(io, parsed);
  await send(io.fetch, destination, projectUrl(destination, '/delivery/deployments'), {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  io.out(`Recorded a ${status} deployment to ${environment} (${body.externalId}).`);
  return EXIT.ok;
}

/** `automate agent-config [--branch --commit --dir]` — sends the agent files under the directory. */
export async function agentConfig(argv: readonly string[], io: Io): Promise<ExitCode> {
  const parsed = parseOptions(argv, { values: ['project', 'branch', 'commit', 'dir'] });
  const branch = branchOf(io, optional(parsed, 'branch'));
  if (branch === undefined || branch === '') throw usage('--branch is required');
  const commit = commitOf(io, optional(parsed, 'commit'));
  const destination = target(io, parsed);
  const { files, skipped } = await collectAgentConfig(
    path.resolve(io.cwd, optional(parsed, 'dir') ?? '.'),
  );
  for (const file of skipped) io.out(`Skipped ${file}: over the size or file limit.`);
  const result = (await send(
    io.fetch,
    destination,
    projectUrl(destination, '/health/agent-config'),
    {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ branch, ...(commit === undefined ? {} : { commit }), files }),
    },
  )) as { findings?: unknown; mcpServers?: unknown } | null;
  io.out(
    `Sent ${String(files.length)} agent-config file(s): ${String(result?.findings ?? 0)} finding(s), ${String(result?.mcpServers ?? 0)} MCP server(s).`,
  );
  return EXIT.ok;
}
