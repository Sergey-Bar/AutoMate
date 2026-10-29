/**
 * A preload (`node --import`) that records, and refuses, every network use a process makes
 * other than to its own loopback address.
 *
 * Patched at the lowest layer each protocol shares: `net.Socket.prototype.connect` carries
 * TCP for `http`, `https`, `tls` and `fetch` (undici opens its sockets through `net`);
 * `dns.lookup` and `dns.promises.lookup` carry name resolution; `dgram` sockets carry UDP.
 * Each attempt is appended to the file named by `AUTOMATE_OFFLINE_LOG` before it fails, so a
 * caller that swallows the error still leaves the evidence. The first line written is
 * `armed`, so a test can tell "nothing was attempted" from "the guard never loaded".
 */
import { appendFileSync } from 'node:fs';
import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';

const LOG = process.env['AUTOMATE_OFFLINE_LOG'];
if (LOG === undefined || LOG === '') throw new Error('AUTOMATE_OFFLINE_LOG is not set');

/** @param {string} line */
const record = (line) => appendFileSync(LOG, `${line}\n`);
record('armed');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

/** @param {string} what */
const refuse = (what) => {
  record(what);
  return Object.assign(new Error(`network use refused by the offline guard: ${what}`), {
    code: 'EOFFLINE',
  });
};

/**
 * The host a `connect` call names, or null for a local socket path (a pipe).
 *
 * @param {unknown[]} args
 * @returns {string | null}
 */
function hostOf(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return hostOf(first);
  if (typeof first === 'object' && first !== null) {
    const options = /** @type {{ path?: string, host?: string }} */ (first);
    if (typeof options.path === 'string') return null;
    return options.host ?? 'localhost';
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return typeof second === 'string' ? second : 'localhost';
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = /** @type {typeof connect} */ (
  function guardedConnect(/** @type {unknown[]} */ ...args) {
    const host = hostOf(args);
    if (host !== null && !LOOPBACK.has(host)) {
      const error = refuse(`tcp ${host}`);
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return Reflect.apply(connect, this, args);
  }
);

const lookup = dns.lookup;
dns.lookup = /** @type {typeof lookup} */ (
  function guardedLookup(/** @type {any[]} */ ...args) {
    const [hostname] = args;
    if (LOOPBACK.has(String(hostname))) return Reflect.apply(lookup, dns, args);
    const callback = args.find((arg) => typeof arg === 'function');
    const error = refuse(`dns ${String(hostname)}`);
    if (callback !== undefined) process.nextTick(() => callback(error));
    return undefined;
  }
);
const promisedLookup = dns.promises.lookup;
dns.promises.lookup = /** @type {typeof promisedLookup} */ (
  async (/** @type {any[]} */ ...args) => {
    if (LOOPBACK.has(String(args[0]))) return Reflect.apply(promisedLookup, dns.promises, args);
    throw refuse(`dns ${String(args[0])}`);
  }
);

dgram.createSocket = /** @type {typeof dgram.createSocket} */ (
  (/** @type {any[]} */ ...args) => {
    throw refuse(`udp ${JSON.stringify(args[0])}`);
  }
);
