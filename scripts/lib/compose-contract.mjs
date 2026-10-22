/**
 * The contract the compose files have to satisfy about the object store.
 *
 * `apps/api/src/startup-policy.ts` refuses to start in production without
 * `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`,
 * `OBJECT_STORE_ACCESS_KEY_ID` and `OBJECT_STORE_SECRET_ACCESS_KEY` — artifact bytes
 * are evidence, and on one process's filesystem they disappear with it. That
 * enforcement is real and has been all along.
 *
 * The gap was that **no compose file supplied the five variables**, so the documented
 * production stack could not have booted: `infra/compose/docker-compose.unified.yml` set
 * `NODE_ENV: production` on the API with none of them, and the policy would have thrown
 * at startup. `compose.dev.yml` ran a MinIO service that nothing referenced and nothing
 * waited on. The policy was correct and the deployment contradicted it, which is the
 * same class of defect as a gate with no instrument: the check existed, the thing it
 * checked was never wired up, and nothing noticed.
 *
 * `pnpm compose:config` cannot catch this. It resolves interpolation and reports syntax,
 * and a compose file that omits five variables is a perfectly valid compose file. So
 * this module reads the committed files and asserts the wiring, which means deleting
 * those five lines becomes a failing test rather than a deployment that stops working
 * for whoever tries it next.
 *
 * **On parsing YAML.** There is no YAML library in this repository and the plan's D18
 * caps new dependencies at two, neither of which is a parser. So this is a focused
 * extractor for the one shape that matters, and it is a *parser* rather than a regular
 * expression, so an environment line it does not understand throws instead of quietly
 * producing an empty set. That distinction is the whole reason to write this instead of
 * grepping: a grep for `OBJECT_STORE_ENDPOINT` would pass on a file where the variable
 * appears in a comment, in the wrong service, or with trailing whitespace, and would
 * keep passing after the wiring it was meant to protect had been deleted.
 *
 * The scanning is deliberately three small functions — `serviceLines`, `blockLines`,
 * `environmentMap` — rather than one state machine. The single-machine version was
 * written first and measured cognitive complexity 28 against a ceiling of 15, which is
 * the complexity ratchet's whole argument for extracting early: a loop with six
 * branches and nesting inside it is not readable, and nesting is what the metric counts.
 */

/** The variables the production policy requires. Order is the policy's own. */
export const REQUIRED_OBJECT_STORE_VARIABLES = [
  'OBJECT_STORE_ENDPOINT',
  'OBJECT_STORE_BUCKET',
  'OBJECT_STORE_REGION',
  'OBJECT_STORE_ACCESS_KEY_ID',
  'OBJECT_STORE_SECRET_ACCESS_KEY',
];

/** The image whose startup policy enforces the contract above. */
const API_DOCKERFILE = /(^|\/)api\.Dockerfile$/;

/**
 * Strip a trailing comment that is not inside quotes.
 *
 * Compose values legitimately contain `#` — a bucket or access key can, and
 * `PUBLIC_APP_URL: http://host/#anchor` can — so a naive split would corrupt real
 * values and then report a key whose value it misread. Only an unquoted ` #` opens a
 * comment.
 *
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote !== '') {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1] ?? ''))) {
      return line.slice(0, index);
    }
  }
  return line;
}

/**
 * The indentation of a line, or `null` for a blank or comment-only one.
 *
 * @param {string} line
 * @returns {number | null}
 */
function indentOf(line) {
  const match = /^(\s*)\S/.exec(line);
  if (match === null) return null;
  return (match[1] ?? '').length;
}

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip one layer of matching quotes. @param {string} value @returns {string} */
function unquote(value) {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2);
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

/**
 * The lines belonging to one service, comments stripped, including blank ones.
 *
 * Stops at the first line indented no further than the service key, which is what makes
 * a sibling service's block unable to leak into this one — the bug a single-pass
 * scanner had, where `NODE_ENV` for one service could be read out of another's block.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {string[]}
 */
function serviceLines(text, serviceName) {
  const lines = text.split(/\r?\n/).map(stripComment);
  const header = new RegExp(`^\\s{2}${escapeRegExp(serviceName)}\\s*:\\s*$`);
  const start = lines.findIndex((line) => header.test(line.trimEnd()));
  if (start === -1) return [];
  const base = indentOf(lines[start] ?? '') ?? 2;

  /** @type {string[]} */
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const indent = indentOf(line);
    if (indent === null) {
      body.push(line);
      continue;
    }
    if (indent <= base) break;
    body.push(line);
  }
  return body;
}

/**
 * The lines of one named block inside one service, comments stripped.
 *
 * @param {string} text
 * @param {string} serviceName
 * @param {string} blockKey for example `environment` or `build`
 * @returns {string[]}
 */
function blockLines(text, serviceName, blockKey) {
  const own = serviceLines(text, serviceName);
  const header = new RegExp(`^\\s*${escapeRegExp(blockKey)}\\s*:\\s*$`);
  const start = own.findIndex((line) => header.test(line.trim()));
  if (start === -1) return [];
  const base = indentOf(own[start] ?? '') ?? 2;

  /** @type {string[]} */
  const body = [];
  for (let index = start + 1; index < own.length; index += 1) {
    const line = own[index] ?? '';
    const indent = indentOf(line);
    if (indent === null) continue;
    if (indent <= base) break;
    body.push(line);
  }
  return body;
}

/**
 * The `environment:` block of one service, as a map of key to its raw value.
 *
 * Handles both shapes compose accepts — `KEY: value` and `- KEY=value` — and leaves
 * interpolation intact on purpose: the point is that the line *exists*, and
 * `docker compose config` is what resolves it.
 *
 * A **map** rather than a key set, because the first version returned only keys and read
 * values with a whole-file search, so a service's configuration could be taken from
 * whichever service appeared first. A contract check that reads one service's settings
 * out of another's block is a contract check on nothing.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {Map<string, string>}
 * @throws when the block holds a line this extractor cannot account for
 */
export function environmentMap(text, serviceName) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const line of blockLines(text, serviceName, 'environment')) {
    const mapping = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (mapping !== null && mapping[1] !== undefined) {
      found.set(mapping[1], unquote(mapping[2] ?? ''));
      continue;
    }
    const entry = /^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (entry !== null && entry[1] !== undefined) {
      found.set(entry[1], unquote(entry[2] ?? ''));
      continue;
    }
    throw new Error(
      `unparseable line in the \`environment:\` block of service \`${serviceName}\`: ` +
        `${JSON.stringify(line)}. This extractor only understands \`KEY: value\` and ` +
        '`- KEY=value`; it throws rather than returning a partial set, because a partial ' +
        'set is indistinguishable from a missing variable.',
    );
  }
  return found;
}

/**
 * The `environment:` keys of one service.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {Set<string>}
 */
export function environmentKeys(text, serviceName) {
  return new Set(environmentMap(text, serviceName).keys());
}

/**
 * What a service declares as its `NODE_ENV`, or `null` when it declares none.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {string | null}
 */
export function nodeEnvOf(text, serviceName) {
  const value = environmentMap(text, serviceName).get('NODE_ENV');
  return value === undefined || value === '' ? null : value;
}

/**
 * The Dockerfile a service builds from, or `null`.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {string | null}
 */
export function buildDockerfileOf(text, serviceName) {
  for (const line of blockLines(text, serviceName, 'build')) {
    const found = /^\s*dockerfile\s*:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (found !== null && (found[1] ?? '') !== '') return found[1] ?? null;
  }
  return null;
}

/**
 * Whether the object-store contract applies to a service at all.
 *
 * Scoped to the API image because that is where the enforcement lives. The first
 * version applied the rule to every service declaring `NODE_ENV: production` and
 * immediately flagged `worker` and `runner` — the rule being wrong, not the compose
 * file. Neither ever executes `startup-policy.ts` and neither reads an object store, and
 * a contract check that demands configuration from a process which does not enforce the
 * contract trains people to satisfy checks mechanically, which is how a real one gets
 * ignored. Matching on the image rather than the service *name* means renaming `api`
 * cannot silently opt it out.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {boolean}
 */
export function enforcesObjectStorePolicy(text, serviceName) {
  if (nodeEnvOf(text, serviceName) !== 'production') return false;
  const dockerfile = buildDockerfileOf(text, serviceName);
  if (dockerfile !== null) return API_DOCKERFILE.test(dockerfile);
  // No build block means a published image, so the name is the only signal available.
  return serviceName === 'api';
}

/**
 * The service names a compose file declares, from its top-level `services:` block.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function serviceNames(text) {
  /** @type {string[]} */
  const names = [];
  let inServices = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (/^services\s*:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    const indent = indentOf(line);
    if (indent === null) continue;
    if (indent === 0) break;
    const name = /^\s{2}([A-Za-z0-9_.-]+)\s*:\s*$/.exec(line);
    if (name !== null && (name[1] ?? '') !== '') names.push(name[1] ?? '');
  }
  return names;
}

/**
 * The host of an endpoint, or `''` when there is nothing to check.
 *
 * `''` for three distinct reasons, all meaning "not a bare compose service name": the
 * variable is absent, it is entirely an interpolation like `${OBJECT_STORE_ENDPOINT}`
 * (resolved by `docker compose config`, not by this file), or it is an external host — a
 * dotted name, a port, or loopback. Only a bare hostname is something the compose network
 * would try to resolve, and only that can be checked against `services:` here.
 *
 * @param {string} endpoint
 * @returns {string}
 */
function safeHost(endpoint) {
  if (endpoint === '' || endpoint.includes('${')) return '';
  const host = (endpoint.replace(/^https?:\/\//, '').split('/')[0] ?? '').split(':')[0] ?? '';
  if (host === '' || host.includes('.') || host === 'localhost') return '';
  return host;
}

/**
 * Every way one compose file breaks the object-store contract.
 *
 * Two rules, because there are two distinct ways to get this wrong and only the first is
 * obvious. A **production API service can declare fewer than the five variables**, which
 * is the original defect and produces a stack that cannot boot. A declared endpoint can
 * **name a service the file does not declare**, which produces a stack that boots and
 * then cannot reach its object store — a worse failure, because it is a runtime
 * connection error rather than a startup refusal, and it gets further before it fails.
 *
 * @param {string} file for the message
 * @param {string} text the compose file
 * @returns {string[]}
 */
export function composeProblems(file, text) {
  /** @type {string[]} */
  const problems = [];
  const declared = serviceNames(text);
  for (const service of declared.length > 0 ? declared : ['api']) {
    if (!enforcesObjectStorePolicy(text, service)) continue;
    const environment = environmentMap(text, service);

    const missing = REQUIRED_OBJECT_STORE_VARIABLES.filter((name) => !environment.has(name));
    if (missing.length > 0) {
      problems.push(
        `${file}: service \`${service}\` sets NODE_ENV: production but does not declare ` +
          `${missing.join(', ')}. \`apps/api/src/startup-policy.ts\` refuses to start a ` +
          'production deployment without the object store — artifact bytes are evidence, ' +
          "and on one process's filesystem they disappear with it — so this stack would not " +
          'boot. Declare the variables, or do not claim the service is production.',
      );
    }

    const host = safeHost(environment.get('OBJECT_STORE_ENDPOINT') ?? '');
    if (host !== '' && !declared.includes(host)) {
      problems.push(
        `${file}: service \`${service}\` points OBJECT_STORE_ENDPOINT at \`${host}\`, which ` +
          `this file does not declare as a service (it has ${JSON.stringify(declared)}). On ` +
          'the compose network that name does not resolve, so the stack would boot and then ' +
          'fail every artifact write with a connection error rather than a startup refusal.',
      );
    }
  }
  return problems;
}

// ─── The stack has to boot on a machine that has never seen it ─────────────────────
//
// The rules above protect the object-store wiring. The ones below protect the first
// `docker compose up` on a clean machine, which is the only experience a person who
// downloads a release has. Each was a real defect in the committed files (ledger
// MNT-19 onward): an image the stack refused to pull, a variable the API refuses to boot
// without, and a proxy upstream on a port nothing listens on.

/**
 * Variables the production API refuses to start without.
 *
 * `apps/api/src/startup-policy.ts` refuses the five secrets and `DATABASE_URL`, and
 * `apps/api/src/index.ts` refuses a database-backed production boot with no
 * `AUTOMATE_INSTALLATION_KEY` (`NO_INSTALLATION_KEY`). The test beside this module reads
 * both files and fails if a name here is not refused there, or one refused there is not
 * here, so this list cannot become a second authority that drifts.
 */
export const REQUIRED_PRODUCTION_VARIABLES = [
  'DATABASE_URL',
  'COOKIE_SECRET',
  'REPORTER_SECRET',
  'AUTOMATE_API_KEY',
  'VAULT_SECRET',
  'RUNNER_REGISTRATION_SECRET',
  'AUTOMATE_INSTALLATION_KEY',
];

/**
 * A scalar key set directly on a service (`image:`, `pull_policy:`), or `null`.
 *
 * Only the service's own level counts, so `image:` inside some nested block is not
 * mistaken for the service's image.
 *
 * @param {string} text
 * @param {string} serviceName
 * @param {string} key
 * @returns {string | null}
 */
export function serviceScalar(text, serviceName, key) {
  const pattern = new RegExp(`^\\s{4}${escapeRegExp(key)}\\s*:\\s*(\\S.*)$`);
  for (const line of serviceLines(text, serviceName)) {
    if (indentOf(line) !== 4) continue;
    const found = pattern.exec(line.trimEnd());
    if (found !== null) return unquote(found[1] ?? '');
  }
  return null;
}

/**
 * Every way a compose file would fail to start on a machine that has never run it.
 *
 * - `pull_policy: never` refuses to fetch an image the machine does not already have,
 *   so the first `up` anywhere new fails before a container exists.
 * - an `image:` with no tag, or `:latest`, is a different image on every pull, so two
 *   installs of one release are not the same install.
 * - a production API service that does not declare a variable the API refuses to boot
 *   without is a stack whose `api` exits on start and whose dependants wait forever.
 *
 * @param {string} file for the message
 * @param {string} text the compose file
 * @returns {string[]}
 */
export function bootProblems(file, text) {
  /** @type {string[]} */
  const problems = [];
  for (const service of serviceNames(text)) {
    if (serviceScalar(text, service, 'pull_policy') === 'never') {
      problems.push(
        `${file}: service \`${service}\` sets pull_policy: never, so it cannot start on a ` +
          'machine that does not already hold the image. Remove it.',
      );
    }
    const image = serviceScalar(text, service, 'image');
    if (image !== null && !image.includes('${') && !/:[^/]+$/.test(image)) {
      problems.push(
        `${file}: service \`${service}\` uses image \`${image}\` with no tag, which is ` +
          'whatever the registry serves today. Pin a version.',
      );
    } else if (image !== null && image.endsWith(':latest')) {
      problems.push(`${file}: service \`${service}\` pins \`${image}\`, which is not a version.`);
    }
    if (!enforcesObjectStorePolicy(text, service)) continue;
    const environment = environmentMap(text, service);
    const missing = REQUIRED_PRODUCTION_VARIABLES.filter((name) => !environment.has(name));
    if (missing.length > 0) {
      problems.push(
        `${file}: service \`${service}\` sets NODE_ENV: production but does not declare ` +
          `${missing.join(', ')}, which the API refuses to boot without ` +
          '(`apps/api/src/startup-policy.ts`, `NO_INSTALLATION_KEY` in `apps/api/src/index.ts`).',
      );
    }
  }
  return problems;
}

/**
 * nginx `upstream` servers whose port disagrees with what the target listens on.
 *
 * @param {string} file for the message
 * @param {string} conf the nginx configuration
 * @param {Map<string, number>} listening service name to the port it listens on
 * @returns {string[]}
 */
export function upstreamProblems(file, conf, listening) {
  /** @type {string[]} */
  const problems = [];
  for (const match of conf.matchAll(/upstream\s+(\S+)\s*\{\s*server\s+([^:;\s]+):(\d+)\s*;/g)) {
    const host = match[2] ?? '';
    const port = Number(match[3]);
    const expected = listening.get(host);
    if (expected !== undefined && expected !== port) {
      problems.push(
        `${file}: upstream \`${match[1] ?? ''}\` proxies to ${host}:${String(port)}, but ` +
          `${host} listens on ${String(expected)}, so every request it serves fails with 502.`,
      );
    }
  }
  return problems;
}

/**
 * The `ports:` entries one service publishes, as written.
 *
 * @param {string} text
 * @param {string} serviceName
 * @returns {string[]}
 */
export function publishedPorts(text, serviceName) {
  return blockLines(text, serviceName, 'ports').map((line) =>
    unquote(line.replace(/^\s*-\s*/, '')),
  );
}

/** What the production stack publishes: one port, loopback unless the operator says otherwise. */
export const FRONT_DOOR = '${AUTOMATE_BIND:-127.0.0.1}:${AUTOMATE_PORT:-8080}:8080';

/**
 * Every way the production stack publishes something other than its one front door.
 *
 * A user opens one URL. Each extra published port is a second way in that skips the
 * proxy's headers and body cap, and a database port on a machine with no login in front
 * of the product is a database anyone on the machine can reach.
 *
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
export function frontDoorProblems(file, text) {
  /** @type {string[]} */
  const problems = [];
  const published = serviceNames(text).flatMap((service) =>
    publishedPorts(text, service).map((port) => ({ service, port })),
  );
  for (const { service, port } of published) {
    if (service === 'edge' && port === FRONT_DOOR) continue;
    problems.push(
      `${file}: service \`${service}\` publishes \`${port}\`. The production stack publishes ` +
        `exactly one port, the edge proxy's \`${FRONT_DOOR}\`.`,
    );
  }
  if (!published.some(({ service, port }) => service === 'edge' && port === FRONT_DOOR)) {
    problems.push(
      `${file}: no \`edge\` service publishes \`${FRONT_DOOR}\`, so there is no front door.`,
    );
  }
  return problems;
}
