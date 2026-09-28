import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every connector answers the operation the caller names, or refuses by name.
 *
 * Finding P-12 is three claims in three files, all with the same root: the adapter
 * answered one hardcoded request whatever the caller asked, so a manifest could declare
 * operations that were unreachable. Each adapter now holds a dispatch table beside its
 * manifest, and this reads both — from the source, because the two are separate objects
 * and a test that called them would only prove the adapter agrees with itself.
 *
 * Reading source to check a runtime contract is a last resort. It is here because the
 * alternative is a manifest that can drift from the code with nothing noticing, which is
 * the exact shape of the defect: the manifest said `postMessage` and the code said
 * `auth.test`, and both were true. `operationSpec` already refuses an operation the
 * manifest does not declare; this refuses the other direction — an operation the code can
 * perform and the manifest does not advertise, which is a capability a caller cannot find.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONNECTORS = [
  { name: 'slack', module: 'slack', adapter: 'slackAdapter' },
  { name: 'github', module: 'github', adapter: 'githubAdapter' },
  { name: 'jira', module: 'jira', adapter: 'jiraAdapter' },
] as const;

for (const connector of CONNECTORS) {
  const source = readFileSync(path.join(root, connector.module, 'src', 'index.ts'), 'utf8');

  describe(`${connector.name}: the manifest and the dispatch table agree`, () => {
    it('declares the connector', () => {
      expect(source).toContain(`export const ${connector.adapter}`);
    });

    it('can perform every operation it declares, and performs nothing else', () => {
      // The manifest block: `name: 'jira'` then the `operations: { … }` entries, up to
      // the closing of the object. Read once and reused, so both sides of the comparison
      // come from the same place.
      const manifestBlock = /operations:\s*\{([\s\S]*?)\n\s{4}\},/.exec(source);
      expect(manifestBlock, 'the manifest block was not found').not.toBeNull();
      const declared = [
        ...(manifestBlock?.[1] ?? '').matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm),
      ].map((m) => m[1] ?? '');
      expect(declared.length).toBeGreaterThan(0);

      // The dispatch table: `const OPERATIONS: Record<string, …> = { … }`.
      const tableBlock = /const OPERATIONS: Record<string, [A-Za-z]+> = \{([\s\S]*?)\n\};/.exec(
        source,
      );
      expect(tableBlock, 'the dispatch table was not found').not.toBeNull();
      const implemented = [
        ...(tableBlock?.[1] ?? '').matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*\{/gm),
      ].map((m) => m[1] ?? '');

      // Both directions. The first is the row's defect; the second is a capability a
      // caller cannot discover, which is the same problem wearing the other hat.
      expect(implemented.slice().sort()).toEqual(declared.slice().sort());
    });

    it('agrees with the manifest about which operations are safe to repeat', () => {
      // The adapters hand `idempotent` to the retry policy, so the manifest is what
      // actually decides whether a 502 arriving after a create produces a second
      // issue (P-13). An earlier cut looked the flag up twice — once in the manifest,
      // once through a defensive `undefined` check in each adapter — and nothing
      // checked that the two answers agreed.
      //
      // The assertion is scoped to the `executeWithRetry` options object on purpose.
      // The manifest itself necessarily contains `idempotent: true` and
      // `idempotent: false` — those are the claims — so a whole-file search for a
      // hard-coded value matches the very declarations that make the check true.
      const callSites = [...source.matchAll(/executeWithRetry\(([\s\S]*?)\n\s*\);/g)].map(
        (m) => m[1] ?? '',
      );
      expect(callSites.length, 'no executeWithRetry call site was found').toBeGreaterThan(0);

      for (const callSite of callSites) {
        const options = /\{\s*retries:[\s\S]*?\}/.exec(callSite)?.[0] ?? '';
        expect(options, 'the call site passes no options object').toContain('idempotent');
        // Bound to something read at run time. A literal here would make every
        // operation's safety a constant, which is how a create gets run twice.
        expect(
          options,
          'idempotency is hard-coded at the call site instead of read from the manifest',
        ).not.toMatch(/idempotent:\s*(true|false)\b/);
        // Either `idempotent: spec.idempotent` or the `{ idempotent }` shorthand — both
        // bind a value; only a literal decides the policy at the call site.
        expect(options).toMatch(/idempotent:\s*[A-Za-z_$][\w$.]*|[{,]\s*idempotent\s*[,}]/);
      }
    });

    it('is dispatched by name, not answered with a constant', () => {
      // The literal that the row names for this adapter, in the form the defect takes
      // after someone fixes the host: one URL, whatever the caller asked.
      const fetchCalls = [...source.matchAll(/await fetch\(([^,]+),/g)].map((m) => m[1] ?? '');
      expect(fetchCalls.length).toBeGreaterThan(0);
      for (const argument of fetchCalls) {
        // A path built from the dispatch table or from the operation's own fields, rather
        // than a bare literal with no reference to the request.
        expect(argument, `fetch(${argument}, …) does not read the request`).toMatch(
          /operation|path|url|base|API/,
        );
      }
    });
  });
}

describe('the shared dispatch helpers', () => {
  it('are exported from the sdk, so an adapter cannot invent its own', () => {
    const sdk = readFileSync(path.join(root, 'sdk', 'src', 'index.ts'), 'utf8');
    for (const helper of [
      'export function operationSpec',
      'export function requireString',
      'export class ConnectorInputError',
      'export class ConnectorRejectionError',
    ]) {
      expect(sdk, `${helper} is missing from the sdk`).toContain(helper);
    }
  });
});
