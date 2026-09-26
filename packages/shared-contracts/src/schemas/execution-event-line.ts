import { z } from 'zod/v4';

/**
 * One event line, as a runner writes it and the API reads it.
 *
 * This shape existed as a third `ReporterEventSchema` — in `apps/runner` — which
 * was neither the contract's reporter event (an envelope with
 * `contractVersion`/`eventId`/`occurredAt` and a `data` payload) nor the realtime
 * package's flat broadcast event. It was, field for field, the execution event
 * the API's `ExecutionEventInput` describes. The name was simply wrong, which
 * is the hazard the plan names: one identifier, several validators, and nothing
 * wrong at compile time.
 *
 * It lives here because this is the wire boundary between a runner and the API,
 * and `@automate/shared-contracts` is the leaf both already depend on — so one
 * declaration serves both instead of two that can drift.
 */
export const ExecutionEventLineSchema = z.object({
  eventId: z.string().min(1),
  sequence: z.number().int().min(1),
  // A known type, or a string a newer runner sends. Rejecting an unknown type
  // here would drop it on the floor, and a durable stream is the wrong place to
  // decide that a type is illegitimate.
  type: z.string().min(1),
  // Required on the line itself, and an ISO-8601 instant **with an offset**,
  // which is the rule the API's own batch schema already enforced. The runner's
  // local copy used to accept any `Date.parse`-able string, so a runner emitting
  // a zoneless timestamp passed its own parser and was then rejected on ingest by
  // the API that was supposed to accept it. One schema, one rule, and the failure
  // now surfaces in the runner where it is fixable.
  //
  // A *reader* may still tolerate an absent timestamp — the API's `EventSchema`
  // relaxes exactly this field and nothing else, because the store falls back to
  // arrival time. A producer that omits it is a bug; a consumer that rejects it is
  // a different bug, and conflating the two is how a wire format gets tightened
  // by accident.
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type ExecutionEventLine = z.infer<typeof ExecutionEventLineSchema>;
