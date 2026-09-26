import path from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** @param {NodeJS.ProcessEnv} env */
export function assertLocalRehearsal(env) {
  if (env['REHEARSAL_MODE'] !== 'local') throw new Error('Rehearsal requires REHEARSAL_MODE=local');
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('Rehearsal requires DATABASE_URL');
  let parsed;
  try {
    parsed = new globalThis.URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid URL');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error('Rehearsal database must be loopback');
  if (env['PUBLISH'] === 'true' || env['PRODUCTION_CUTOVER'] === 'true') {
    throw new Error('Publication and production cutover are forbidden during rehearsal');
  }
  return { databaseHost: parsed.hostname, databaseName: parsed.pathname.slice(1) };
}

/** @param {string} root @param {string} candidate */
export function isLocalPathWithin(root, candidate) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(root, candidate);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}
