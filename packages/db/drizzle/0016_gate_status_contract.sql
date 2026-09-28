-- W1.4 — `runs.gate_status` accepts the values the contract defines, and stops
-- accepting one it does not.
--
-- `0009_enum_constraints.sql` pinned this column to `('passed','failed','skipped')`
-- while `GateStatusSchema` in `@automate/shared-contracts` — what the API and the client
-- both validate against — defines
-- `('passed','failed','warning','unknown','not_evaluated')`. The two disagreed in **both**
-- directions: the database rejected `warning`, `unknown` and `not_evaluated` outright,
-- and accepted `skipped`, which no contract defines and no client can send. A gate that
-- could legitimately be in a warning state had nowhere to be written, and a value the
-- product cannot represent was writable.
--
-- The drift was invisible to the compiler because `execution.ts` imports `runs` from
-- `dashboard.ts`, so the shared `GATE_STATUSES` constant could not be imported back and
-- the column carried a hand-written second copy (ledger P-5). That is fixed in
-- `schema/vocabularies.ts`; this migration is the data side of the same correction.
--
-- **The pre-audit, which is the part that matters.** Widening a CHECK is only safe once
-- every existing row is known to fall inside the new set — and here the new set is
-- *narrower* for one value, because `skipped` is not a contract value. So:
--
--   1. Rows are counted against every value the old constraint permitted, so an
--      operator sees the blast radius in the transaction rather than in a rollback.
--   2. `skipped` is mapped to `not_evaluated`, which is what a skipped gate *is* — it
--      was not evaluated — rather than a new invented value. This is a semantic claim,
--      so it is made once, here, in one statement, and the audit above says how many
--      rows it touched.
--   3. Any value outside the union of the old and new sets raises. The old CHECK
--      guarantees that cannot happen today, and the guard means it still cannot after
--      someone relaxes the constraint by hand — a row that reaches the new CHECK and is
--      outside all seven values would otherwise be rejected by the CHECK itself, with
--      a less actionable message and no count.

-- Step 1 — the pre-audit. Read-only; safe to run repeatedly.
DO $$
DECLARE
  skipped_rows integer;
  unknown_rows integer;
BEGIN
  SELECT count(*) INTO skipped_rows FROM runs WHERE gate_status = 'skipped';
  SELECT count(*) INTO unknown_rows FROM runs
   WHERE gate_status IS NOT NULL
     AND gate_status NOT IN ('passed', 'failed', 'skipped');

  RAISE NOTICE 'runs.gate_status pre-audit: % row(s) to map skipped -> not_evaluated, % row(s) outside the old constraint',
    skipped_rows, unknown_rows;

  IF unknown_rows > 0 THEN
    RAISE EXCEPTION
      '% run row(s) carry a gate_status outside the old constraint''s three values. The constraint was '
      'relaxed by hand at some point; these rows must be resolved before the contract vocabulary is '
      'applied, because this migration will not guess what they meant.',
      unknown_rows;
  END IF;
END
$$;

-- Step 2 — map the one value the contract does not define onto the one that means the
-- same thing. A skipped gate was not evaluated; that is `not_evaluated`, verbatim.
UPDATE runs SET gate_status = 'not_evaluated' WHERE gate_status = 'skipped';

-- Step 3 — replace the constraint with the contract's five values. Dropped and
-- re-added rather than altered, because Postgres cannot alter a CHECK in place.
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_gate_status_check;
ALTER TABLE runs
  ADD CONSTRAINT runs_gate_status_check
  CHECK ("gate_status" IS NULL OR "gate_status" IN ('passed', 'failed', 'warning', 'unknown', 'not_evaluated'));
