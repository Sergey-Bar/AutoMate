/**
 * A semgrep probe fixture for the transport rule. Not application code and never
 * executed.
 *
 * The loopback exemption is the twin that matters here: `no-cleartext-transport-in-client`
 * shipped an exemption written against a pattern ending at `http://`, which
 * `pattern-not-regex` could never match, so it was written and then had nothing
 * to exclude. Both halves are asserted by `scripts/lib/semgrep-rules.test.mjs`.
 */

/* eslint-disable */

/** HAZARD: a cleartext request the session cookie rides on. */
export function hazardCleartextTransport() {
  return fetch('http://api.example.com/v1/runs', { credentials: 'include' });
}

/** HAZARD: axios in cleartext, the same rule through another client. */
export function hazardCleartextAxios() {
  return require('axios').post('http://api.example.com/v1/runs', {});
}

/** SAFE: loopback never leaves the machine, so there is no path to read it. */
export function safeLoopbackTransport() {
  return fetch('http://localhost:3000/health');
}

/** SAFE: loopback by address rather than by name. */
export function safeLoopbackAddress() {
  return fetch('http://127.0.0.1:3000/health');
}

/** SAFE: TLS. */
export function safeTlsTransport() {
  return fetch('https://api.example.com/v1/runs');
}
