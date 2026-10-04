import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@automate/db';
import { literalView } from '@automate/projects';
import {
  discoverProject,
  discoverProjectAtBoot,
  listProjects,
  readScoreInputs,
  slugifyProjectName,
  type ProjectRegistryServiceOptions,
} from './project-registry-service.js';

/**
 * Boot-time project discovery.
 *
 * PGlite over the real migration graph, for the same reason `routes/projects.test.ts`
 * uses it: the claims under test are about the `projects` unique constraint and the
 * workspace foreign key, and neither is observable against a mocked repository.
 */

const NODE_REPO: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({
    name: 'svc',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^4.1.5' },
  }),
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
};

/** A repository no detector recognises: words, and no manifest. */
const UNRECOGNISED_REPO: Readonly<Record<string, string>> = { 'README.md': '# just words\n' };

function migrationSql(): string {
  const drizzleDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/db/drizzle',
  );
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

async function migrated(): Promise<{
  client: PGlite;
  options: ProjectRegistryServiceOptions;
}> {
  const client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  return {
    client,
    options: {
      db: db as never,
      workspaceId: 'ws-1',
      viewFor: () => literalView(NODE_REPO),
    },
  };
}

function collector() {
  const lines: Array<{ level: string; msg: string; context: Record<string, unknown> }> = [];
  return {
    lines,
    info: (msg: string, context: Record<string, unknown> = {}) => {
      lines.push({ level: 'info', msg, context });
    },
    warn: (msg: string, context: Record<string, unknown> = {}) => {
      lines.push({ level: 'warn', msg, context });
    },
  };
}

describe('boot registers the folder it was pointed at', () => {
  it('derives the name and the slug from the folder basename', async () => {
    const { client, options } = await migrated();
    try {
      const outcome = await discoverProject(options, {
        repoPath: '/repos/Payments API',
        log: collector(),
      });
      expect(outcome.outcome).toBe('registered');
      const { projects } = await listProjects(options).then((rows) => ({ projects: rows }));
      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe('Payments API');
      expect(projects[0]?.slug).toBe('payments-api');
      expect(projects[0]?.repoPath).toBe(path.resolve('/repos/Payments API'));
    } finally {
      await client.close();
    }
  });

  it('re-detects an already-registered folder instead of creating a second project', async () => {
    const { client, options } = await migrated();
    try {
      await discoverProject(options, { repoPath: '/repos/svc', log: collector() });
      // A `package.json` that gained a test runner yesterday has to show up today
      // with nobody pressing a button. Second call must refresh the same row.
      const second = await discoverProject(options, { repoPath: '/repos/svc', log: collector() });
      expect(second.outcome).toBe('refreshed');
      const rows = await listProjects(options);
      expect(rows).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('treats a different textual spelling of the same folder as the same project', async () => {
    const { client, options } = await migrated();
    try {
      await discoverProject(options, { repoPath: '/repos/svc', log: collector() });
      const second = await discoverProject(options, {
        repoPath: '/repos/./nested/../svc',
        log: collector(),
      });
      expect(second.outcome).toBe('refreshed');
      expect(await listProjects(options)).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});

describe('a folder name that cannot be a slug', () => {
  it('yields a slug the register schema accepts', () => {
    // The same regex `RegisterProjectBodySchema` enforces. A 422 at boot because a
    // folder is called `My Project` is the whole failure this function exists to stop.
    const acceptable = /^[a-z0-9][a-z0-9._-]*$/u;
    for (const name of ['My Project', 'Ünïcodé Näme', '---', 'A'.repeat(120), '9lives']) {
      const slug = slugifyProjectName(name);
      expect(slug, name).toMatch(acceptable);
      expect(slug.length, name).toBeLessThanOrEqual(64);
      expect(slug.length, name).toBeGreaterThan(0);
    }
  });

  it('leaves a slug that is already valid alone, so re-derivation is stable', () => {
    expect(slugifyProjectName('automate')).toBe('automate');
    expect(slugifyProjectName('my.service_2')).toBe('my.service_2');
  });

  it('skips a colliding slug with a log line rather than throwing', async () => {
    const { client, options } = await migrated();
    try {
      // Two folders whose basenames differ and whose slugs do not: `Payments API`
      // becomes `payments-api`, and so does `Payments-API`. Registering either would
      // make every per-project rollup ambiguous, so the second one is skipped and said.
      await discoverProject(options, { repoPath: '/repos/Payments API', log: collector() });
      const log = collector();
      const outcome = await discoverProject(options, { repoPath: '/repos/Payments-API', log });
      expect(outcome.outcome).toBe('skipped');
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]?.level).toBe('warn');
      const rows = await listProjects(options);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.slug).toBe('payments-api');
    } finally {
      await client.close();
    }
  });
});

describe('a folder nothing can be detected in', () => {
  it('registers nothing, says so, and does not throw', async () => {
    const { client, options } = await migrated();
    try {
      const log = collector();
      const outcome = await discoverProject(
        { ...options, viewFor: () => literalView(UNRECOGNISED_REPO) },
        { repoPath: '/repos/docs', log },
      );
      expect(outcome.outcome).toBe('unrecognised');
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]?.msg).toMatch(/no runnable suite/iu);
      // **Nothing registered.** A confident-looking row with an empty proposal is
      // worse than no row: the cockpit would analyse a folder that has no suite in
      // it and report fifteen zeroes as a verdict.
      expect(await listProjects(options)).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it('rethrows a failure that is not a detection problem, so it is not hidden', async () => {
    const { client, options } = await migrated();
    try {
      // Only a *collision* is a skip. A permission error or a dead database is a
      // failure, and reporting it as "nothing to see here" is how a broken install
      // looks like an empty one.
      await expect(
        discoverProject(
          {
            ...options,
            viewFor: () => ({
              async paths(): Promise<readonly string[]> {
                throw new Error('EACCES');
              },
              async read(): Promise<string | null> {
                return null;
              },
            }),
          },
          { repoPath: '/repos/svc', log: collector() },
        ),
      ).rejects.toThrow('EACCES');
    } finally {
      await client.close();
    }
  });
});

describe('readScoreInputs reads a window, not the whole history', () => {
  it('returns only runs at or before `at`', async () => {
    const { client, options } = await migrated();
    try {
      const registered = await discoverProject(options, {
        repoPath: '/repos/svc',
        log: collector(),
      });
      expect(registered.outcome).toBe('registered');
      const projectId = registered.outcome === 'registered' ? registered.project.id : '';

      await client.query(
        `INSERT INTO runs (id, workspace_id, project_id, started_at, phase, outcome)
         VALUES
           ('00000000-0000-4000-8000-00000000aaa1', 'ws-1', $1, '2026-10-01T00:00:00.000Z', 'complete', 'passed'),
           ('00000000-0000-4000-8000-00000000aaa2', 'ws-1', $1, '2026-10-05T00:00:00.000Z', 'complete', 'failed')`,
        [projectId],
      );

      const all = await readScoreInputs(options, projectId);
      expect(all.runs).toHaveLength(2);

      // **The whole of the Slice 4 fix.** `at` used to be a label: both ends of a
      // diff read every row and the route subtracted one from the other.
      const before = await readScoreInputs(options, projectId, '2026-10-02T00:00:00.000Z');
      expect(before.runs).toHaveLength(1);
      expect((before.runs[0] as { id: string }).id).toBe('00000000-0000-4000-8000-00000000aaa1');

      const after = await readScoreInputs(options, projectId, '2026-10-06T00:00:00.000Z');
      expect(after.runs).toHaveLength(2);

      // And an `at` before every run is an empty window, not the whole history. This
      // is the case the false "an empty diff is a true answer" claim was covering up.
      const none = await readScoreInputs(options, projectId, '2026-09-01T00:00:00.000Z');
      expect(none.runs).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});

describe('discovery is opt-in and never fatal', () => {
  it('does nothing, and says so, when no root is configured', async () => {
    const { client, options } = await migrated();
    try {
      const log = collector();
      await expect(discoverProjectAtBoot(options, undefined, log)).resolves.toBeUndefined();
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]?.msg).toMatch(/AUTOMATE_PROJECT_ROOT/u);
      expect(await listProjects(options)).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it('swallows a discovery failure, because a folder without a manifest is not an outage', async () => {
    const { client, options } = await migrated();
    try {
      const log = collector();
      await expect(
        discoverProjectAtBoot(
          {
            ...options,
            viewFor: () => ({
              async paths(): Promise<readonly string[]> {
                throw new Error('EACCES');
              },
              async read(): Promise<string | null> {
                return null;
              },
            }),
          },
          '/repos/svc',
          log,
        ),
      ).resolves.toBeUndefined();
      expect(log.lines.some((line) => line.level === 'warn')).toBe(true);
      expect(await listProjects(options)).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});
