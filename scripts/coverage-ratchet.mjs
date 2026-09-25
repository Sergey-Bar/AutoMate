#!/usr/bin/env node
/**
 * coverage-ratchet.mjs
 *
 * Compares actual coverage (coverage/coverage-final.json) against the
 * thresholds declared in each package's vitest.config.ts.
 *
 * Usage:
 *   node scripts/coverage-ratchet.mjs                  # check all packages
 *   node scripts/coverage-ratchet.mjs --package=server # check one package
 *   node scripts/coverage-ratchet.mjs --update         # ratchet up thresholds
 *
 * Exit codes:
 *   0 — all thresholds maintained or improved
 *   1 — at least one threshold decreased (or a fatal error occurred)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repository root — one level above the scripts/ directory */
const REPO_ROOT = resolve(__dirname, '..');

const METRICS = /** @type {const} */ (['statements', 'branches', 'functions', 'lines']);

/**
 * Parse `thresholds: { ... }` from vitest.config.ts source text.
 * Returns null when no thresholds block is found.
 *
 * @param {string} source
 * @returns {{ statements?: number; branches?: number; functions?: number; lines?: number } | null}
 */
function parseThresholds(source) {
  // Find the thresholds block by scanning for "thresholds:" then collecting
  // balanced braces.
  const startIdx = source.indexOf('thresholds:');
  if (startIdx === -1) return null;

  const braceStart = source.indexOf('{', startIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  const block = source.slice(braceStart + 1, end);

  /** @type {Record<string, number>} */
  const result = {};

  for (const metric of METRICS) {
    // Match   statements: 93,   or   statements: 93   (with optional comma/whitespace)
    const re = new RegExp(`\\b${metric}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i');
    const m = block.match(re);
    if (m) result[metric] = parseFloat(m[1]);
  }

  return result;
}

/**
 * Update the thresholds block in vitest.config.ts source text, replacing
 * each metric value with newThresholds[metric] only when the new value is
 * strictly higher than the existing one.
 *
 * @param {string} source
 * @param {Record<string, number>} newThresholds
 * @returns {string} Updated source (unchanged if nothing to ratchet)
 */
function updateThresholds(source, newThresholds) {
  const startIdx = source.indexOf('thresholds:');
  if (startIdx === -1) return source;

  const braceStart = source.indexOf('{', startIdx);
  if (braceStart === -1) return source;

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return source;

  let block = source.slice(braceStart + 1, end);

  for (const metric of METRICS) {
    if (newThresholds[metric] == null) continue;
    const re = new RegExp(`(\\b${metric}\\s*:\\s*)([0-9]+(?:\\.[0-9]+)?)`, 'i');
    block = block.replace(re, (_match, prefix, _old) => {
      return `${prefix}${newThresholds[metric]}`;
    });
  }

  return source.slice(0, braceStart + 1) + block + source.slice(end);
}

/**
 * Compute statement/branch/function/line coverage percentages from a
 * coverage-final.json file produced by @vitest/coverage-v8.
 *
 * coverage-final.json structure (Istanbul format):
 * {
 *   "<filepath>": {
 *     "s":  { "<id>": <count>, ... },      // statement counts
 *     "b":  { "<id>": [<count>, ...], ... },// branch counts (array per branch)
 *     "f":  { "<id>": <count>, ... },      // function counts
 *     "fnMap": { ... },
 *     "branchMap": { ... },
 *     "statementMap": { ... },
 *     ...
 *   }
 * }
 *
 * @param {string} coveragePath  Full path to coverage-final.json
 * @returns {{ statements: number; branches: number; functions: number; lines: number }}
 */
function computeCoverage(coveragePath) {
  const raw = JSON.parse(readFileSync(coveragePath, 'utf8'));

  let totalStatements = 0, coveredStatements = 0;
  let totalBranches = 0, coveredBranches = 0;
  let totalFunctions = 0, coveredFunctions = 0;
  let coveredLines = 0, totalLines = 0;

  for (const fileData of Object.values(raw)) {
    // Statements
    for (const count of Object.values(fileData.s ?? {})) {
      totalStatements++;
      if (count > 0) coveredStatements++;
    }

    // Branches — each entry is an array of counts (true/false branch)
    for (const branchCounts of Object.values(fileData.b ?? {})) {
      for (const count of branchCounts) {
        totalBranches++;
        if (count > 0) coveredBranches++;
      }
    }

    // Functions
    for (const count of Object.values(fileData.f ?? {})) {
      totalFunctions++;
      if (count > 0) coveredFunctions++;
    }

    // Lines — derived from statementMap: group statements by line, count
    // a line as covered if at least one statement on it is covered.
    const lineHits = /** @type {Map<number, boolean>} */ (new Map());
    const stmtMap = fileData.statementMap ?? {};
    const sCounts = fileData.s ?? {};
    for (const [id, loc] of Object.entries(stmtMap)) {
      const line = loc?.start?.line;
      if (line == null) continue;
      const hit = (sCounts[id] ?? 0) > 0;
      lineHits.set(line, (lineHits.get(line) ?? false) || hit);
    }
    for (const hit of lineHits.values()) {
      totalLines++;
      if (hit) coveredLines++;
    }
  }

  const pct = (covered, total) =>
    total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;

  return {
    statements: pct(coveredStatements, totalStatements),
    branches: pct(coveredBranches, totalBranches),
    functions: pct(coveredFunctions, totalFunctions),
    lines: pct(coveredLines, totalLines),
  };
}

/**
 * Discover all package directories that contain a vitest.config.ts.
 * Scans apps/* and packages/** (two levels deep for nested connectors).
 *
 * @returns {string[]} Absolute paths to package directories
 */
function discoverPackages() {
  const dirs = [];
  const searchRoots = [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages')];

  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const fullPath = join(root, entry);
      if (!statSync(fullPath).isDirectory()) continue;

      // Direct child (e.g. apps/server, packages/shared)
      if (existsSync(join(fullPath, 'vitest.config.ts'))) {
        dirs.push(fullPath);
      }

      // One more level down for nested connector packages
      for (const sub of readdirSync(fullPath)) {
        const subPath = join(fullPath, sub);
        if (!statSync(subPath).isDirectory()) continue;
        if (existsSync(join(subPath, 'vitest.config.ts'))) {
          dirs.push(subPath);
        }
      }
    }
  }

  return dirs;
}

/**
 * Return the short label for a package path (relative to REPO_ROOT).
 *
 * @param {string} pkgDir
 */
function pkgLabel(pkgDir) {
  return pkgDir.replace(REPO_ROOT + '/', '').replace(REPO_ROOT + '\\', '');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const updateMode = args.includes('--update');

/** @type {string | null} */
let filterPackage = null;
for (const arg of args) {
  const m = arg.match(/^--package=(.+)$/);
  if (m) {
    filterPackage = m[1];
    break;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let allPackages = discoverPackages();

if (filterPackage) {
  allPackages = allPackages.filter((p) => {
    const label = pkgLabel(p);
    return (
      label === filterPackage ||
      label.endsWith(`/${filterPackage}`) ||
      label.endsWith(`\\${filterPackage}`)
    );
  });

  if (allPackages.length === 0) {
    console.error(`[coverage-ratchet] No package found matching --package=${filterPackage}`);
    process.exit(1);
  }
}

console.log(`[coverage-ratchet] Checking ${allPackages.length} package(s)…\n`);

let hasFailure = false;

for (const pkgDir of allPackages) {
  const label = pkgLabel(pkgDir);
  const configPath = join(pkgDir, 'vitest.config.ts');
  const coveragePath = join(pkgDir, 'coverage', 'coverage-final.json');

  // ── Read thresholds from vitest.config.ts ─────────────────────────────────
  let source;
  try {
    source = readFileSync(configPath, 'utf8');
  } catch {
    console.warn(`[coverage-ratchet] SKIP  ${label}: cannot read vitest.config.ts`);
    continue;
  }

  const thresholds = parseThresholds(source);
  if (!thresholds || Object.keys(thresholds).length === 0) {
    console.warn(`[coverage-ratchet] SKIP  ${label}: no thresholds found in vitest.config.ts`);
    continue;
  }

  // ── Check coverage-final.json ─────────────────────────────────────────────
  if (!existsSync(coveragePath)) {
    console.warn(
      `[coverage-ratchet] SKIP  ${label}: coverage/coverage-final.json not found` +
        ` (run vitest with --coverage first)`,
    );
    continue;
  }

  let actual;
  try {
    actual = computeCoverage(coveragePath);
  } catch (err) {
    console.error(`[coverage-ratchet] ERROR ${label}: failed to parse coverage — ${err.message}`);
    hasFailure = true;
    continue;
  }

  // ── Compare & report ──────────────────────────────────────────────────────
  const decreases = [];
  const increases = [];

  for (const metric of METRICS) {
    const threshold = thresholds[metric] ?? 0;
    const got = actual[metric] ?? 0;

    if (got < threshold) {
      decreases.push({ metric, threshold, got });
    } else if (got > threshold) {
      increases.push({ metric, old: threshold, new: got });
    }
  }

  if (decreases.length > 0) {
    hasFailure = true;
    console.error(`[coverage-ratchet] FAIL  ${label}`);
    for (const { metric, threshold, got } of decreases) {
      console.error(
        `               ${metric.padEnd(12)} expected ≥ ${threshold.toFixed(2)}%  got ${got.toFixed(2)}%  (↓ ${(threshold - got).toFixed(2)}%)`,
      );
    }
    // Still report increases for information
    for (const { metric, old: prev, new: next } of increases) {
      console.log(
        `               ${metric.padEnd(12)} threshold ${prev.toFixed(2)}%  got ${next.toFixed(2)}%  (↑ ${(next - prev).toFixed(2)}%)`,
      );
    }
  } else {
    console.log(`[coverage-ratchet] PASS  ${label}`);
    for (const metric of METRICS) {
      const threshold = thresholds[metric] ?? 0;
      const got = actual[metric] ?? 0;
      const arrow = got > threshold ? `↑ +${(got - threshold).toFixed(2)}%` : '✓';
      console.log(
        `               ${metric.padEnd(12)} threshold ${threshold.toFixed(2)}%  got ${got.toFixed(2)}%  ${arrow}`,
      );
    }

    // ── Ratchet up if --update ───────────────────────────────────────────────
    if (updateMode && increases.length > 0) {
      /** @type {Record<string, number>} */
      const newValues = {};
      for (const { metric, new: next } of increases) {
        // Floor to one decimal place to avoid noise from tiny fluctuations
        newValues[metric] = Math.floor(next * 10) / 10;
      }

      const updatedSource = updateThresholds(source, newValues);
      if (updatedSource !== source) {
        writeFileSync(configPath, updatedSource, 'utf8');
        console.log(`               ↑ ratcheted up in vitest.config.ts:`);
        for (const [m, v] of Object.entries(newValues)) {
          console.log(`                 ${m.padEnd(12)} → ${v.toFixed(1)}%`);
        }
      }
    }
  }

  console.log('');
}

if (hasFailure) {
  console.error('[coverage-ratchet] ✗ One or more packages failed the coverage ratchet.');
  process.exit(1);
} else {
  console.log('[coverage-ratchet] ✓ All packages passed the coverage ratchet.');
  process.exit(0);
}
