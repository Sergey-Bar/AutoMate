import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { createReporterResultsRoute } from './reporter-results.js';

/**
 * The same credential, sent the same way, on two routes that used to answer
 * differently.
 *
 * `apps/api/src` had five `Bearer` parsers and they disagreed about whitespace,
 * about scheme casing, and about what an empty token means. A caller could hold a
 * working secret, send a header a well-behaved HTTP client would consider correct,
 * and be rejected by one route and accepted by the next.
 *
 * These are route-level assertions on purpose: the parser itself has unit tests, and
 * a unit test of a parser cannot show that the *route* changed status code. The
 * 403-below case is the one that was most confusing — a client that sent nothing
 * got "invalid credential" from one route and "missing credential" from the rest.
 */

const SECRET = 'reporter-secret';
const digest = 'e'.repeat(64);

const result = {
  contractVersion: '2' as const,
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed' as const,
  startedAt: '2026-09-25T00:00:00.000Z',
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'example',
      status: 'passed' as const,
      rawStatus: 'passed',
      startedAt: '2026-09-25T00:00:00.000Z',
      evidence: [],
      flakiness: 'unknown' as const,
    },
  ],
  steps: [],
  evidence: [],
  provenance: {
    producer: 'playwright' as const,
    producerVersion: '1.0.0',
    adapterVersion: '1.0.0',
    sourceDigest: digest,
    sourceUri: 'artifact://run-1/report.json',
  },
  retention: { class: 'standard' as const },
  proof: { state: 'verified', digest, verifier: 'test' },
  completeness: { state: 'complete', missingShards: [], duplicateShards: [] },
  raw: {},
};

function app(): Hono {
  return new Hono().route(
    '/',
    createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
      reporterSecret: SECRET,
    }),
  );
}

/** A distinct run id per call, so a duplicate result is never what answers. */
let call = 0;
function freshResult() {
  call += 1;
  return { ...result, identity: { ...result.identity, runId: `run-${call}` } };
}

async function post(authorization: string | undefined) {
  return app().request('/api/v1/reporter/results', {
    method: 'POST',
    body: JSON.stringify(freshResult()),
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
  });
}

describe('one bearer parser, across the routes that used to disagree', () => {
  it('accepts the scheme in any case, because RFC 6750 says it is case-insensitive', async () => {
    // Every one of the five parsers tested `startsWith('Bearer ')`, so a client that
    // lowercased the scheme — entirely legal, and what a few HTTP libraries do — was
    // rejected on every route.
    for (const header of [
      `Bearer ${SECRET}`,
      `bearer ${SECRET}`,
      `BEARER ${SECRET}`,
      `BeArEr ${SECRET}`,
    ]) {
      const response = await post(header);
      expect(response.status, `authorization: ${header.slice(0, 12)}...`).toBe(202);
    }
  });

  it('accepts a header with extra whitespace around the credential', async () => {
    // `'Bearer ' + token` where the token was already trimmed produces two spaces.
    // Two of the five parsers accepted that; three did not.
    for (const header of [`Bearer  ${SECRET}`, `Bearer   ${SECRET}`, `  Bearer ${SECRET}  `]) {
      const response = await post(header);
      expect(response.status, `authorization: ${JSON.stringify(header)}`).toBe(202);
    }
  });

  it('answers 401 for a header with the scheme and no credential', async () => {
    // The confusing one: `reporter.ts` used to treat this as a *wrong* credential
    // and answer 403, where every other route answered 401. A client could not tell
    // "you sent nothing" from "you sent the wrong thing", so it could not decide
    // whether to retry or to stop.
    for (const header of ['Bearer ', 'Bearer', 'Bearer    ']) {
      const response = await post(header);
      expect(response.status, `authorization: ${JSON.stringify(header)}`).toBe(401);
    }
  });

  it('still rejects a wrong credential, and a different scheme', async () => {
    expect((await post(`Bearer wrong-secret`)).status).toBe(401);
    expect((await post(`Basic ${SECRET}`)).status).toBe(401);
    expect((await post(undefined)).status).toBe(401);
    // A token that merely contains the scheme name is not a bearer credential.
    expect((await post(`XBearer ${SECRET}`)).status).toBe(401);
  });
});
