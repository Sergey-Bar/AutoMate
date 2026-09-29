// `client.ts` was re-exported here until 2026-09-29. It was a second HTTP client
// for the runner protocol, and the runner binary uses its own at
// `apps/runner/src/client.ts` — so nothing in the workspace ever imported it,
// while its own test suite kept it green and made it look maintained.
//
// Two clients and two test suites for one endpoint pair is how a protocol change
// lands in one and silently misses the other. `scripts/lib/dead-exports.test.mjs`
// fails if a name reappears here without a consumer.
export * from './spool.js';
