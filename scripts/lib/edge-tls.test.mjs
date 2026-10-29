import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * HTTPS on the LAN, read from the files the edge image is built from.
 *
 * The edge is nginx in a read-only container, so TLS cannot be switched on by editing its
 * configuration at runtime. It is switched on by an entrypoint script that writes two small
 * includes into the container's tmpfs when a certificate is mounted. These assertions pin
 * the three pieces to each other: the includes the main config reads, the files the script
 * writes, and the Dockerfile that puts the script where the nginx image runs it.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (/** @type {string} */ file) => readFileSync(path.join(REPO_ROOT, file), 'utf8');

const EDGE_CONF = read('infra/nginx/edge.conf');
const ENTRYPOINT = read('infra/nginx/40-automate-tls.sh');
const CERT_SCRIPT = read('infra/nginx/automate-lan-cert.sh');
const DOCKERFILE = read('infra/docker/edge.Dockerfile');

test('the main config reads the TLS includes from the tmpfs, and probes without a redirect', () => {
  assert.match(EDGE_CONF, /include \/tmp\/automate\/tls-server\*\.conf;/);
  assert.match(EDGE_CONF, /include \/tmp\/automate\/http-redirect\*\.conf;/);
  // The healthcheck must still answer 2xx over plain HTTP once every other path redirects.
  assert.match(EDGE_CONF, /location = \/edge-health \{\s*return 204;/);
});

test('the entrypoint writes exactly the includes the config reads, and only with a certificate', () => {
  assert.match(ENTRYPOINT, /\/tmp\/automate\/tls-server\.conf/);
  assert.match(ENTRYPOINT, /\/tmp\/automate\/http-redirect\.conf/);
  assert.match(ENTRYPOINT, /\[ -f "\$CERT_DIR\/server\.crt" \]/);
  assert.match(ENTRYPOINT, /listen 8443 ssl/);
  assert.match(ENTRYPOINT, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(ENTRYPOINT, /Strict-Transport-Security/);
  assert.match(ENTRYPOINT, /return 308 https:\/\//);
});

test('every API path an outside client calls is proxied to the API, over HTTP and HTTPS', () => {
  // An identity provider calls SCIM at /scim/v2 (ADR-014). The edge proxied only /api/ to
  // the API and everything else to the web container, so on the shipped stack SCIM answered
  // with the dashboard's HTML. Derived from the authz matrix: a route outside /api/ that is
  // not a container probe must have a location that reaches the API in both servers.
  const matrix = JSON.parse(read('docs/quality/authz-matrix.json'));
  const PROBES = new Set(['/health', '/ready', '/metrics']);
  const prefixes = [
    ...new Set(
      matrix.routes
        .map((/** @type {{ path: string }} */ route) => route.path)
        .filter((/** @type {string} */ route) => !route.startsWith('/api/') && !PROBES.has(route))
        .map((/** @type {string} */ route) => `/${route.split('/').slice(1, 3).join('/')}/`),
    ),
  ];
  assert.deepEqual(prefixes, ['/scim/v2/']);
  for (const [name, text] of [
    ['edge.conf', EDGE_CONF],
    ['40-automate-tls.sh', ENTRYPOINT],
  ]) {
    for (const prefix of prefixes) {
      assert.match(
        text,
        new RegExp(
          `location ${prefix.replaceAll('/', '\\/')} \\{\\s*proxy_pass http:\\/\\/automate_api;`,
        ),
        `${name} does not proxy ${prefix} to the API`,
      );
    }
  }
});

test('the certificate script keeps an existing CA and issues a leaf an iPhone accepts', () => {
  // A new CA would have to be trusted again on every device; it is only replaced on request.
  assert.match(
    CERT_SCRIPT,
    /if \[ ! -f "\$CERT_DIR\/ca\.key" \] \|\| \[ "\$\{AUTOMATE_NEW_CA:-\}" = "1" \]/,
  );
  // Apple refuses a TLS leaf valid for more than 825 days.
  assert.match(CERT_SCRIPT, /-days 825/);
  assert.match(CERT_SCRIPT, /subjectAltName/);
  assert.match(CERT_SCRIPT, /extendedKeyUsage=serverAuth/);
  // The CA key never leaves the host directory readable by anyone else.
  assert.match(CERT_SCRIPT, /chmod 600 "\$CERT_DIR\/ca\.key"/);
});

test('the image ships both scripts where they run, and the CLI that creates the certificates', () => {
  assert.match(DOCKERFILE, /apk add --no-cache openssl/);
  assert.match(
    DOCKERFILE,
    /COPY infra\/nginx\/40-automate-tls\.sh \/docker-entrypoint\.d\/40-automate-tls\.sh/,
  );
  assert.match(
    DOCKERFILE,
    /COPY infra\/nginx\/automate-lan-cert\.sh \/usr\/local\/bin\/automate-lan-cert/,
  );
  assert.match(DOCKERFILE, /EXPOSE 8080 8443/);
});

/**
 * The `server` block in `edge.conf` that listens on `port`, by brace depth.
 *
 * @param {number} port
 * @returns {string}
 */
function serverListening(port) {
  const start = EDGE_CONF.search(new RegExp(`server \\{\\s*listen ${String(port)};`));
  assert.ok(start >= 0, `edge.conf has no server listening on ${String(port)}`);
  let depth = 0;
  for (let index = EDGE_CONF.indexOf('{', start); index < EDGE_CONF.length; index += 1) {
    if (EDGE_CONF[index] === '{') depth += 1;
    if (EDGE_CONF[index] === '}') depth -= 1;
    if (depth === 0) return EDGE_CONF.slice(start, index + 1);
  }
  throw new Error(`the server on ${String(port)} is not closed`);
}

test('a visitor through the tunnel is keyed by the address Cloudflare saw (PRO-16)', () => {
  // Behind the tunnel every request came from the cloudflared container, so the sign-in
  // limits counted every remote visitor as one and the audit trail recorded the tunnel. The
  // tunnel gets a listener of its own that forwards Cloudflare's `CF-Connecting-IP` as the
  // address the API keys on. It must be reachable only on the compose network: on a port a
  // browser can reach, anyone could set that header and pick their own address.
  const tunnel = serverListening(8081);
  assert.match(
    EDGE_CONF,
    /map \$http_cf_connecting_ip \$automate_tunnel_client \{\s*''\s+\$remote_addr;\s*default\s+\$http_cf_connecting_ip;\s*\}/,
  );
  const forwarded = [...tunnel.matchAll(/proxy_set_header X-Forwarded-For (\S+);/g)].map(
    (match) => match[1],
  );
  assert.ok(forwarded.length >= 3, 'every location in the tunnel server sets X-Forwarded-For');
  assert.deepEqual([...new Set(forwarded)], ['$automate_tunnel_client']);
  // Cloudflare ends TLS, so the API sees https, and the LAN certificate's redirect does not apply.
  assert.doesNotMatch(tunnel, /http-redirect/);
  assert.match(tunnel, /proxy_set_header X-Forwarded-Proto https;/);
  // Every other listener keeps appending its own peer, and never reads the header.
  const plain = serverListening(8080);
  assert.doesNotMatch(plain, /cf_connecting_ip|automate_tunnel_client/);
  assert.doesNotMatch(ENTRYPOINT, /cf_connecting_ip|automate_tunnel_client/);
  // Not published: the compose file maps 8080 and 8443 to the host, and nothing else.
  const compose = read('infra/compose/docker-compose.unified.yml');
  assert.doesNotMatch(compose, /:8081['"]?\s*$/m);
  assert.match(compose, /public hostname points at `http:\/\/edge:8081`/);
});
