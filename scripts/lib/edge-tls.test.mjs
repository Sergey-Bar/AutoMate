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
