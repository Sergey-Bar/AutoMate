import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach } from 'vitest';
import { SECRET_MIN_LENGTH, isSecretPlaceholder, type SecretVariable } from '@automate/config';
import { getConfig, readObjectStoreSettings } from './config.js';
import { checkProductionPolicy } from './startup-policy.js';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

const OBJECT_STORE_ENV = {
  OBJECT_STORE_ENDPOINT: 'https://objects.example.com',
  OBJECT_STORE_BUCKET: 'automate-artifacts',
  OBJECT_STORE_REGION: 'eu-central-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'secret-access-key-value',
  OBJECT_STORE_FORCE_PATH_STYLE: 'true',
  OBJECT_STORE_MAX_BYTES: '1048576',
  OBJECT_STORE_TIMEOUT_MS: '5000',
};

describe('getConfig', () => {
  it('parses canonical cookie and provider settings', () => {
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECRET = 'c'.repeat(SECRET_MIN_LENGTH);
    process.env.VAULT_SECRET = 'v'.repeat(SECRET_MIN_LENGTH);
    process.env.KILO_GATEWAY_URL = 'https://kilo.example';
    process.env.KILO_API_KEY = 'k'.repeat(SECRET_MIN_LENGTH);
    const config = getConfig();
    expect(config.cookieSecret).toBe('c'.repeat(SECRET_MIN_LENGTH));
    expect(config.kiloGatewayUrl).toBe('https://kilo.example');
  });

  it('keeps a configured production cookie secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECRET = 'c'.repeat(SECRET_MIN_LENGTH);
    expect(getConfig().cookieSecret).toBe('c'.repeat(SECRET_MIN_LENGTH));
  });

  it('never hands the development-only cookie secret to a production composition', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COOKIE_SECRET;
    delete process.env.SESSION_SECRET;
    const config = getConfig();
    expect(config.cookieSecret).toBeUndefined();
    // The failure is reported by startup policy, not by a silently forged secret.
    expect(() => checkProductionPolicy(config)).toThrow('COOKIE_SECRET is required in production');
  });

  it('keeps the development-only cookie secret available outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SECRET;
    delete process.env.SESSION_SECRET;
    expect(getConfig().cookieSecret).toBe('development-only-cookie-secret-32-chars');
  });

  it('exposes an explicit legacy artifact read fallback root', () => {
    process.env.NODE_ENV = 'development';
    process.env.ARTIFACT_READ_FALLBACK_ROOT = '/mnt/legacy-artifacts';
    expect(getConfig().artifactReadFallbackRoot).toBe('/mnt/legacy-artifacts');
    delete process.env.ARTIFACT_READ_FALLBACK_ROOT;
  });

  it('exposes the object store settings and keeps development usable without them', () => {
    process.env.NODE_ENV = 'development';
    for (const [key, value] of Object.entries(OBJECT_STORE_ENV)) process.env[key] = value;
    expect(getConfig().objectStore).toEqual({
      endpoint: 'https://objects.example.com',
      bucket: 'automate-artifacts',
      region: 'eu-central-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'secret-access-key-value',
      forcePathStyle: true,
      allowInsecureHttp: false,
      maxBytes: 1048576,
      timeoutMs: 5000,
    });
    for (const key of Object.keys(OBJECT_STORE_ENV)) delete process.env[key];
    expect(getConfig().objectStore).toBeUndefined();
  });
});

describe('readObjectStoreSettings', () => {
  it('returns undefined when no object store variable is set', () => {
    expect(readObjectStoreSettings({})).toBeUndefined();
  });

  it('ignores optional tuning values until a required field is configured', () => {
    expect(
      readObjectStoreSettings({
        OBJECT_STORE_FORCE_PATH_STYLE: 'true',
        OBJECT_STORE_MAX_BYTES: '1048576',
        OBJECT_STORE_TIMEOUT_MS: '5000',
      }),
    ).toBeUndefined();
  });

  it('names the variables a partial configuration is missing', () => {
    expect(() =>
      readObjectStoreSettings({
        OBJECT_STORE_ENDPOINT: 'https://objects.example.com',
        OBJECT_STORE_BUCKET: 'automate-artifacts',
      }),
    ).toThrow(
      'Object store configuration is incomplete; set OBJECT_STORE_REGION, OBJECT_STORE_ACCESS_KEY_ID, OBJECT_STORE_SECRET_ACCESS_KEY',
    );
  });

  it('rejects an unusable endpoint, boolean, or bound', () => {
    const complete = { ...OBJECT_STORE_ENV, OBJECT_STORE_BUCKET: 'Automate' };
    expect(() => readObjectStoreSettings({ ...complete, OBJECT_STORE_BUCKET: 'Automate' })).toThrow(
      'OBJECT_STORE_BUCKET must be a lowercase S3 bucket name',
    );
    expect(() =>
      readObjectStoreSettings({ ...complete, OBJECT_STORE_FORCE_PATH_STYLE: 'yes please' }),
    ).toThrow('OBJECT_STORE_FORCE_PATH_STYLE must be a boolean');
    expect(() => readObjectStoreSettings({ ...complete, OBJECT_STORE_MAX_BYTES: 'lots' })).toThrow(
      'OBJECT_STORE_MAX_BYTES must be a positive integer',
    );
  });

  it('accepts every documented boolean spelling and the byte and timeout bounds', () => {
    for (const [raw, expected] of [
      ['1', true],
      ['true', true],
      ['yes', true],
      ['on', true],
      ['0', false],
      ['false', false],
      ['no', false],
      ['off', false],
    ] as const) {
      expect(
        readObjectStoreSettings({ ...OBJECT_STORE_ENV, OBJECT_STORE_FORCE_PATH_STYLE: raw })
          ?.forcePathStyle,
      ).toBe(expected);
    }
    expect(readObjectStoreSettings(OBJECT_STORE_ENV)?.maxBytes).toBe(1048576);
    expect(readObjectStoreSettings(OBJECT_STORE_ENV)?.timeoutMs).toBe(5000);
    expect(
      readObjectStoreSettings({
        ...OBJECT_STORE_ENV,
        OBJECT_STORE_MAX_BYTES: undefined,
        OBJECT_STORE_TIMEOUT_MS: undefined,
      })?.maxBytes,
    ).toBe(64 * 1024 * 1024);
  });
});

/**
 * The documented credentials, audited by the policy rather than by eye.
 *
 * Finding P-6 raised a floor of 32 and broke twenty-two tests, and the same sweep
 * found credential values in the quickstart, the E2E harness, the performance server
 * and the CI workflow that the production policy has always refused — the README
 * told developers to set a `COOKIE_SECRET` containing `change-me`, which
 * `checkProductionPolicy` rejects. Those are not cosmetic: a documented value is the
 * one a new operator copies, and the copy is what a deployment is built from.
 *
 * Reading the files is the point. A hand-maintained list of the values in this test
 * would drift the moment a document gained a secret, which is the failure this suite
 * exists to catch.
 */
const SECRET_VARIABLES = [
  'COOKIE_SECRET',
  'SESSION_SECRET',
  'VAULT_SECRET',
  'AUTOMATE_API_KEY',
  'REPORTER_SECRET',
  'RUNNER_REGISTRATION_SECRET',
] as const satisfies readonly SecretVariable[];

/**
 * The repository root, at module scope.
 *
 * It was declared inside the `describe` block, which meant the module-level
 * `exportedConst` — added so the audit can follow `AUTOMATE_API_KEY: INSTALLATION_KEY`
 * to the file that declares the value — could not reach it. Hoisted rather than passed
 * as an argument, because three functions below already want it and threading a path
 * through all three to save one constant is not a trade worth making.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('documented credentials are usable by the policy', () => {
  /** Files that hand a real secret value to a process, or tell an operator to set one. */
  const SOURCES = [
    '.env.example',
    '.env.compose.example',
    'playwright.config.ts',
    'scripts/performance-server.mjs',
    'performance/smoke.js',
    'README.md',
    '.github/workflows/unified-ci.yml',
  ] as const;

  for (const source of SOURCES) {
    it(`${source} declares no secret the production policy would refuse`, () => {
      const found = auditSource(readFileSync(path.join(repoRoot, source), 'utf8'));
      expect(found).toEqual([]);
    });
  }

  it('reads a value out of every source, so none of those assertions is vacuous', () => {
    // Without this, a regex that silently matched nothing would pass all seven files
    // and read as "the documentation is clean". The evidence is that each source
    // yields at least one secret the reader can see.
    for (const source of SOURCES) {
      const text = readFileSync(path.join(repoRoot, source), 'utf8');
      expect(assignmentsIn(text), `${source} yielded no readable secret`).not.toHaveLength(0);
    }
  });
});

/**
 * Every secret-shaped string literal on a line that mentions a secret variable.
 *
 * The shapes are not one shape. A `.env` file writes `NAME=value`, a Playwright config
 * writes `NAME: 'value'`, `scripts/performance-server.mjs` writes
 * `NAME: process.env['NAME'] ?? 'value'`, and `performance/smoke.js` reads
 * `__ENV.NAME || 'value'`. A reader that only understood the first would report the
 * documentation as clean while the two script values were never looked at.
 *
 * The variable's own name is skipped, because `process.env['COOKIE_SECRET']` is a
 * lookup and its text is a name, not a value.
 */
function assignmentsIn(text: string): Array<{ variable: SecretVariable; value: string }> {
  const found: Array<{ variable: SecretVariable; value: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const variable = SECRET_VARIABLES.find((name) => line.includes(name));
    if (variable === undefined) continue;
    // Written without a backslash on purpose: `\s` inside this template literal is
    // the letter `s`, which is a silent way to make a reader match nothing.
    for (const literal of line.matchAll(/'([^']+)'|"([^"]+)"/g)) {
      const value = literal[1] ?? literal[2] ?? '';
      if (value === '' || (SECRET_VARIABLES as readonly string[]).includes(value)) continue;
      found.push({ variable, value });
    }
    // The unquoted forms, which is what a `.env` file and a workflow `env:` block use.
    for (const pattern of [
      new RegExp(`\\b${variable}=([^\\s#]+)`),
      new RegExp(`\\b${variable}:\\s+([^\\s#]+)`),
    ]) {
      const bare = pattern.exec(line)?.[1];
      // `NAME: process.env['NAME'] ?? 'value'` is the one shape where the text right
      // after the name is a lookup rather than a value, so it is skipped by name.
      if (bare !== undefined && !bare.startsWith('process.env[')) {
        found.push({ variable, value: bare });
      }
    }
  }
  return found;
}

/**
 * A named export from a repository file, evaluated.
 *
 * `playwright.config.ts` passes `AUTOMATE_API_KEY: INSTALLATION_KEY` — an identifier,
 * not a literal — because the value lives in one place (`e2e/support/config.ts`) and the
 * two files holding it disagreed, which is what made every authenticated E2E call answer
 * 401. `auditSource` measures the *value*, so it has to follow a reference to find it;
 * measuring the identifier instead reports `AUTOMATE_API_KEY=INSTALLATION_KEY (17
 * characters)`, which is a finding about a name rather than about a secret.
 *
 * The expression is read from a file in this repository and evaluated, so the scope of
 * what can run here is the scope of what we wrote. It is deliberately not a general
 * TypeScript evaluator: one `export const NAME = <expression>;` line, and anything else
 * is a resolution failure rather than a silent `undefined`.
 */
function exportedConst(name: string, relativePath: string): string | undefined {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const declaration = new RegExp(`export const ${name} = ([^;]+);`).exec(source);
  if (declaration === null) return undefined;
  const value = new Function(`return (${declaration[1] ?? ''});`)();
  return typeof value === 'string' ? value : undefined;
}

/** The value behind a reference the audited file uses, when it is one we can resolve. */
function referenceResolver(): (identifier: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (identifier) => {
    if (cache.has(identifier)) return cache.get(identifier);
    const value = exportedConst(identifier, 'e2e/support/config.ts');
    cache.set(identifier, value);
    return value;
  };
}

function auditSource(text: string, resolve?: (identifier: string) => string | undefined): string[] {
  const resolved = resolve ?? referenceResolver();
  /** @type {string[]} */
  const found = [];
  for (const { variable, value: written } of assignmentsIn(text)) {
    // A bare value in an object literal carries its trailing comma, so
    // `AUTOMATE_API_KEY: INSTALLATION_KEY,` reaches here as `INSTALLATION_KEY,` — which
    // matches no identifier and would be measured as a 17-character secret. The comma is
    // punctuation around the value, never part of it.
    const trimmed = written.replace(/,$/, '');
    // A bare identifier is a reference, not a secret. Follow it, and if it cannot be
    // followed, say so — an unresolved reference is a hole in the audit, and a hole that
    // reports clean is the failure this file's other test guards against.
    const value = /^[A-Za-z_$][\w$]*$/.test(trimmed) ? resolved(trimmed) : trimmed;
    if (value === undefined) {
      found.push(`${variable}=${trimmed} (a reference this audit cannot resolve)`);
      continue;
    }
    if (value.length < SECRET_MIN_LENGTH) {
      found.push(`${variable}=${value} (${String(value.length)} characters)`);
    }
    if (isSecretPlaceholder(variable, value)) {
      found.push(`${variable}=${value} (a placeholder)`);
    }
  }
  return found;
}
