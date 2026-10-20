/**
 * Routes for the parts of the interface that sit on top of the engine: runs, the toolbox,
 * findings and imports. Each group is a `RouteHandler` for `startServer({ routes })`; a group
 * answers the paths it owns and returns false for everything else.
 */
import { URLSearchParams } from 'node:url';
import { RunnerError } from './runner.mjs';
import { findingsPage } from './ui-findings.mjs';
import { runPage, runsPage, previewPage } from './ui-runs.mjs';
import { toolboxPage } from './ui-toolbox.mjs';

/** Pending previews expire, and there are never many. */
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 20;

/**
 * @param {import('./server.mjs').Context} ctx
 * @returns {Promise<any>}
 */
async function jsonBody(ctx) {
  try {
    const parsed = JSON.parse(await ctx.body());
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object');
    return parsed;
  } catch (error) {
    if (/** @type {Error} */ (error).message === 'body-too-large') throw error;
    throw new RunnerError('INVALID_REQUEST', 'The body must be a JSON object.');
  }
}

/** @param {string} text */
const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * The runner request a submitted form describes.
 *
 * @param {URLSearchParams} form
 */
export function requestFromForm(form) {
  const argv = (form.get('argv') ?? '').split(/\r?\n/);
  while (argv.length > 0 && argv[argv.length - 1] === '') argv.pop();
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of lines(form.get('env') ?? '')) {
    const at = line.indexOf('=');
    if (at < 1) throw new RunnerError('INVALID_REQUEST', `"${line}" is not NAME=value.`);
    env[line.slice(0, at)] = line.slice(at + 1);
  }
  const deadline = (form.get('deadlineSeconds') ?? '').trim();
  return {
    repositoryId: form.get('repositoryId') ?? '',
    argv,
    cwd: (form.get('cwd') ?? '.').trim() || '.',
    deadlineSeconds:
      deadline === '' ? undefined : /^\d+$/.test(deadline) ? Number(deadline) : Number.NaN,
    artifactPaths: lines(form.get('artifactPaths') ?? ''),
    passThrough: lines(form.get('passThrough') ?? ''),
    env,
    secrets: lines(form.get('secrets') ?? ''),
    ...(form.get('retryOf') ? { retryOf: form.get('retryOf') } : {}),
  };
}

/**
 * @param {{ engine: ReturnType<import('./engine.mjs').createEngine>,
 *   runner: ReturnType<import('./runner.mjs').createRunner>, now?: () => number }} deps
 * @returns {import('./server.mjs').RouteHandler}
 */
export function runRoutes({ engine, runner, now = Date.now }) {
  /** @type {Map<string, { request: any, at: number }>} */
  const pending = new Map();
  const roots = () => engine.listRepositories().map((r) => r.root_path);

  /**
   * @param {any} request
   * @param {string} digest
   */
  const remember = (request, digest) => {
    for (const [key, value] of pending) if (now() - value.at > PENDING_TTL_MS) pending.delete(key);
    while (pending.size >= PENDING_MAX)
      pending.delete(/** @type {string} */ (pending.keys().next().value));
    pending.set(digest, { request, at: now() });
  };

  const page = (/** @type {object} */ extra = {}) =>
    runsPage({
      repositories: engine.listRepositories(),
      runs: runner.list({ limit: 50 }),
      activeId: runner.activeId(),
      notice: runner.NOTICE,
      ...extra,
    });

  return async (ctx) => {
    const { url, method } = ctx;
    const segments = url.pathname.split('/').filter(Boolean);
    const api = segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'runs';
    const ui = segments[0] === 'ui' && segments[1] === 'runs';
    const pageRoute = segments[0] === 'runs';
    if (!api && !ui && !pageRoute) return false;

    try {
      // ── API ───────────────────────────────────────────────────────────────────────────
      if (api) {
        const rest = segments.slice(3);
        if (method === 'GET' && rest.length === 0) {
          const repositoryId = url.searchParams.get('repositoryId') ?? undefined;
          ctx.json(200, {
            runs: runner.list(repositoryId === undefined ? {} : { repositoryId }),
            activeId: runner.activeId(),
          });
          return true;
        }
        if (method === 'POST' && rest[0] === 'preview' && rest.length === 1) {
          ctx.json(200, await runner.preview(await jsonBody(ctx)));
          return true;
        }
        if (method === 'POST' && rest.length === 0) {
          ctx.json(202, await runner.start(await jsonBody(ctx)));
          return true;
        }
        const id = rest[0] ?? '';
        const run = id === '' ? null : runner.get(id);
        if (id !== '' && run === null)
          return (ctx.error(404, 'RUN_NOT_FOUND', 'No such run.'), true);
        if (method === 'GET' && rest.length === 1) return (ctx.json(200, run), true);
        if (method === 'GET' && rest[1] === 'output') {
          const stream = url.searchParams.get('stream') === 'stderr' ? 'stderr' : 'stdout';
          const tail = Number(url.searchParams.get('tail') ?? '') || undefined;
          ctx.json(200, runner.output(id, stream, tail === undefined ? {} : { tailBytes: tail }));
          return true;
        }
        if (method === 'GET' && rest[1] === 'retry')
          return (ctx.json(200, runner.retryRequest(id)), true);
        if (method === 'POST' && rest[1] === 'cancel') {
          runner.cancel(id);
          return (ctx.json(202, { status: 'cancelling' }), true);
        }
        return false;
      }

      // ── Pages and forms ───────────────────────────────────────────────────────────────
      if (method === 'GET' && pageRoute && segments.length === 1) {
        const retry = url.searchParams.get('retry');
        if (retry !== null) {
          const { request, needsValues } = runner.retryRequest(retry);
          ctx.html(200, page({ prefill: { ...request, needsValues } }));
          return true;
        }
        ctx.html(200, page());
        return true;
      }
      if (method === 'GET' && pageRoute && segments.length === 2) {
        const run = runner.get(segments[1] ?? '');
        if (run === null) return (ctx.error(404, 'RUN_NOT_FOUND', 'No such run.'), true);
        const repositories = engine.listRepositories();
        ctx.html(
          200,
          runPage({
            run,
            stdout: runner.output(run.id, 'stdout'),
            stderr: runner.output(run.id, 'stderr'),
            roots: repositories.map((r) => r.root_path),
            repositories,
          }),
        );
        return true;
      }
      if (method === 'POST' && ui && segments[2] === 'preview') {
        const form = new URLSearchParams(await ctx.body());
        const request = requestFromForm(form);
        try {
          const preview = await runner.preview(request);
          remember(request, preview.consentDigest);
          ctx.html(200, previewPage({ ...preview, roots: roots() }));
        } catch (error) {
          if (!(error instanceof RunnerError)) throw error;
          ctx.html(
            error.status,
            page({ message: error.message, prefill: { ...request, needsValues: [] } }),
          );
        }
        return true;
      }
      if (method === 'POST' && ui && segments.length === 2) {
        const form = new URLSearchParams(await ctx.body());
        const digest = form.get('consentDigest') ?? '';
        const held = pending.get(digest);
        if (held === undefined || now() - held.at > PENDING_TTL_MS) {
          ctx.html(409, page({ message: 'That preview has expired. Preview the command again.' }));
          return true;
        }
        pending.delete(digest);
        try {
          const { id } = await runner.start({ ...held.request, consentDigest: digest });
          ctx.res.writeHead(303, { Location: `/runs/${id}`, 'Cache-Control': 'no-store' });
          ctx.res.end();
        } catch (error) {
          if (!(error instanceof RunnerError)) throw error;
          ctx.html(error.status, page({ message: error.message }));
        }
        return true;
      }
      if (method === 'POST' && ui && segments[3] === 'cancel') {
        const id = segments[2] ?? '';
        try {
          runner.cancel(id);
        } catch (error) {
          if (!(error instanceof RunnerError)) throw error;
        }
        ctx.res.writeHead(303, { Location: `/runs/${id}`, 'Cache-Control': 'no-store' });
        ctx.res.end();
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof RunnerError) {
        ctx.error(error.status, error.code, error.message);
        return true;
      }
      throw error;
    }
  };
}

/**
 * @param {{ engine: ReturnType<import('./engine.mjs').createEngine> }} deps
 * @returns {import('./server.mjs').RouteHandler}
 */
export function toolboxRoutes({ engine }) {
  return (ctx) => {
    const { url, method } = ctx;
    const segments = url.pathname.split('/').filter(Boolean);
    if (method === 'GET' && url.pathname === '/api/v1/toolbox/catalog') {
      const { catalog, errors } = engine.catalog();
      ctx.json(200, { catalog, errors });
      return true;
    }
    if (
      segments[0] === 'api' &&
      segments[1] === 'v1' &&
      segments[2] === 'repositories' &&
      segments[4] === 'recommendations'
    ) {
      const repositoryId = segments[3] ?? '';
      if (method === 'GET' && segments.length === 5) {
        const view = engine.toolbox(repositoryId);
        if (view === null) return (ctx.error(404, 'NOT_FOUND', 'No such repository.'), true);
        ctx.json(200, {
          recommendations: view.recommendations,
          suppressed: view.suppressed,
          catalogErrors: view.catalogErrors,
        });
        return true;
      }
      if (method === 'GET' && segments[5] === 'install-request' && segments.length === 6) {
        const recommendationId = url.searchParams.get('id') ?? '';
        const request = engine.installRequest(repositoryId, recommendationId);
        if (request === null)
          return (ctx.error(404, 'NOT_FOUND', 'No installable recommendation with that id.'), true);
        ctx.json(200, {
          request,
          note: 'Nothing has been run. Send this to /api/v1/runs/preview, then confirm the preview.',
        });
        return true;
      }
    }
    if (method === 'GET' && url.pathname === '/toolbox') {
      const repositories = engine.listRepositories();
      const chosen = url.searchParams.get('repository') ?? repositories[0]?.id ?? '';
      const view = chosen === '' ? null : engine.toolbox(chosen);
      /** @type {Record<string, any>} */
      const requests = {};
      for (const r of view?.recommendations ?? [])
        requests[r.id] = engine.installRequest(chosen, r.id);
      ctx.html(200, toolboxPage({ repositories, view, catalog: engine.catalog(), requests }));
      return true;
    }
    return false;
  };
}

/**
 * @param {{ engine: ReturnType<import('./engine.mjs').createEngine>,
 *   ai?: ReturnType<import('./ai.mjs').createAiGateway> }} deps
 * @returns {import('./server.mjs').RouteHandler}
 */
export function findingsRoutes({ engine, ai }) {
  const aiStatus = () =>
    ai?.status() ?? {
      enabled: false,
      provider: null,
      note: 'Off. No model is configured and no network client exists in this program.',
    };
  return async (ctx) => {
    const { url, method } = ctx;
    const segments = url.pathname.split('/').filter(Boolean);
    if (method === 'GET' && url.pathname === '/api/v1/ai/status')
      return (ctx.json(200, aiStatus()), true);

    if (
      segments[0] === 'api' &&
      segments[1] === 'v1' &&
      segments[2] === 'repositories' &&
      segments[4] === 'findings'
    ) {
      const repositoryId = segments[3] ?? '';
      if (method === 'GET' && segments.length === 5) {
        const view = engine.findings(repositoryId, {
          includeDismissed: url.searchParams.get('dismissed') === '1',
        });
        return view === null
          ? (ctx.error(404, 'NOT_FOUND', 'No such repository.'), true)
          : (ctx.json(200, view), true);
      }
      if (
        method === 'POST' &&
        segments.length === 7 &&
        (segments[6] === 'dismiss' || segments[6] === 'restore')
      ) {
        const fingerprint = segments[5] ?? '';
        let note = null;
        if (segments[6] === 'dismiss') {
          try {
            const parsed = JSON.parse((await ctx.body()) || '{}');
            note = typeof parsed.note === 'string' ? parsed.note : null;
          } catch {
            return (ctx.error(400, 'BAD_REQUEST', 'The body must be JSON.'), true);
          }
        }
        const done =
          segments[6] === 'dismiss'
            ? engine.dismissFinding(repositoryId, fingerprint, note)
            : engine.restoreFinding(repositoryId, fingerprint);
        return done
          ? (ctx.json(200, { status: segments[6] === 'dismiss' ? 'dismissed' : 'restored' }), true)
          : (ctx.error(404, 'NOT_FOUND', 'No such finding.'), true);
      }
    }

    if (method === 'GET' && url.pathname === '/findings') {
      const repositories = engine.listRepositories();
      const chosen = url.searchParams.get('repository') ?? repositories[0]?.id ?? '';
      const showDismissed = url.searchParams.get('dismissed') === '1';
      const view =
        chosen === '' ? null : engine.findings(chosen, { includeDismissed: showDismissed });
      ctx.html(200, findingsPage({ repositories, view, showDismissed, ai: aiStatus() }));
      return true;
    }
    if (
      method === 'POST' &&
      (url.pathname === '/ui/findings/dismiss' || url.pathname === '/ui/findings/restore')
    ) {
      const form = new URLSearchParams(await ctx.body());
      const repositoryId = form.get('repositoryId') ?? '';
      const fingerprint = form.get('fingerprint') ?? '';
      const done = url.pathname.endsWith('dismiss')
        ? engine.dismissFinding(repositoryId, fingerprint, (form.get('note') ?? '').trim() || null)
        : engine.restoreFinding(repositoryId, fingerprint);
      if (!done) return (ctx.error(404, 'NOT_FOUND', 'No such finding.'), true);
      ctx.res.writeHead(303, {
        Location: `/findings?repository=${encodeURIComponent(repositoryId)}`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end();
      return true;
    }
    return false;
  };
}

/**
 * Imports of CI artifact archives. The archive is named by a path on this computer, the way a
 * repository is, so no upload parsing is needed.
 *
 * @param {{ engine: ReturnType<import('./engine.mjs').createEngine> }} deps
 * @returns {import('./server.mjs').RouteHandler}
 */
export function importRoutes({ engine }) {
  /** @type {Record<string, string>} */
  const REASONS = {
    'no-such-repository': 'No such repository.',
    'not-a-file': 'That path is not a file that can be read.',
    'archive-too-large': 'That archive is larger than this version reads.',
    'not-a-zip': 'That file is not a ZIP archive.',
    'multi-disk': 'Archives that span several files are not supported.',
    'zip64-not-supported': 'ZIP64 archives are not supported.',
    'too-many-entries': 'That archive has too many entries.',
    'bad-central-directory': 'That archive is damaged.',
  };
  return async (ctx) => {
    const { url, method } = ctx;
    const segments = url.pathname.split('/').filter(Boolean);
    const api =
      method === 'POST' &&
      segments[0] === 'api' &&
      segments[2] === 'repositories' &&
      segments[4] === 'imports' &&
      segments.length === 5;
    const ui = method === 'POST' && url.pathname === '/ui/imports';
    if (!api && !ui) return false;
    let repositoryId;
    let archive;
    if (api) {
      repositoryId = segments[3] ?? '';
      try {
        archive = JSON.parse(await ctx.body()).path;
      } catch {
        return (ctx.error(400, 'BAD_REQUEST', 'The body must be JSON with a path.'), true);
      }
    } else {
      const form = new URLSearchParams(await ctx.body());
      repositoryId = form.get('repositoryId') ?? '';
      archive = form.get('path');
    }
    if (typeof archive !== 'string' || archive === '')
      return (ctx.error(400, 'BAD_REQUEST', 'A path is required.'), true);
    const result = await engine.importArchive(repositoryId, archive);
    if (result.status === 'failed') {
      const message = REASONS[result.reason] ?? 'That archive could not be imported.';
      return (
        ctx.error(result.reason === 'no-such-repository' ? 404 : 400, 'IMPORT_FAILED', message),
        true
      );
    }
    if (api) return (ctx.json(200, result), true);
    ctx.res.writeHead(303, {
      Location: `/repositories/${repositoryId}`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end();
    return true;
  };
}
