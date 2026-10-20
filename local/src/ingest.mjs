/**
 * Format detection and dispatch (spike S1). Throwaway prototype code.
 *
 * Detection looks at content, not the file name: a report called `results.xml` can be
 * anything. An unrecognised input is a rejection with a code, so "we could not read it" is
 * never mistaken for "it said nothing".
 */
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { rejected } from './model.mjs';
import { parseCobertura } from './cobertura.mjs';
import { parseJunit } from './junit.mjs';
import { parseLcov } from './lcov.mjs';
import { parsePlaywright } from './playwright.mjs';

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex SHA-256 of the raw bytes
 */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The name of the first element, after any prolog, comments and DOCTYPE. Only a guess from the
 * first bytes; the parser decides what the document really is.
 *
 * @param {string} text
 */
function rootElementOf(text) {
  const stripped = text
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // With and without an internal subset, as two flat patterns: an optional group holding a
    // lazy quantifier is the shape `security/detect-unsafe-regex` refuses.
    .replace(/<!DOCTYPE[^>[]*\[[\s\S]*?\]\s*>/gi, '')
    .replace(/<!DOCTYPE[^>[]*>/gi, '');
  return /<([A-Za-z_][\w.-]*)/.exec(stripped)?.[1] ?? null;
}

/**
 * @param {Uint8Array} bytes
 * @returns {'junit-xml' | 'cobertura-xml' | 'playwright-json' | 'lcov' | null}
 */
export function detectFormat(bytes) {
  const head = new TextDecoder('windows-1252')
    .decode(bytes.subarray(0, 4096))
    .replace(/^\ufeff/, '');
  const trimmed = head.trimStart();
  if (trimmed.startsWith('<'))
    return rootElementOf(trimmed) === 'coverage' ? 'cobertura-xml' : 'junit-xml';
  if (trimmed.startsWith('{')) return 'playwright-json';
  if (/^(TN:|SF:)/m.test(head)) return 'lcov';
  return null;
}

/**
 * @param {Uint8Array} bytes
 * @param {{ repoRoot?: string, xml?: Partial<import('./xml.mjs').XmlLimits>, maxTests?: number }} [options]
 */
export function ingest(bytes, options = {}) {
  const artifact = { sha256: sha256(bytes), byteSize: bytes.byteLength };
  if (bytes.byteLength === 0) return { artifact, result: rejected('unknown', 'empty-input') };
  const format = detectFormat(bytes);
  if (format === 'junit-xml') return { artifact, result: parseJunit(bytes, options) };
  if (format === 'cobertura-xml') return { artifact, result: parseCobertura(bytes, options) };
  if (format === 'playwright-json') return { artifact, result: parsePlaywright(bytes, options) };
  if (format === 'lcov') return { artifact, result: parseLcov(bytes, options) };
  return { artifact, result: rejected('unknown', 'unrecognised-format') };
}
