-- Q0.15 item 7 — `system_audit_events` was a duplicate of `audit_events`.
--
-- The two are not two views of the same thing. `system_audit_events` is a strict
-- *subset*: actorType, actorId, action, resourceType, resourceId, requestId,
-- details and the instant. Everything it holds, `audit_events` holds — plus `ip`,
-- `userAgent`, `tenantId`, `workspaceId` and `createdAt`, which is what makes an
-- audit row attributable and scannable. Neither table has a single writer in
-- application code; there is one audit table in this schema, and this was the
-- other one.
--
-- It also declared its indexes as `audit_events_resource_idx` and
-- `audit_events_retain_idx`, so a reader of the schema — or of a query plan —
-- would attribute them to `audit_events`. `retain_until` does not exist on
-- `audit_events` at all, so the name was not merely misplaced but actively
-- wrong.
--
-- Nothing references it: no foreign key points at it, and no code reads or
-- writes it. Dropping it is the correction; the audit trail that actually gets
-- recorded lives in `audit_events`.

DROP INDEX IF EXISTS "audit_events_resource_idx";
DROP INDEX IF EXISTS "audit_events_retain_idx";
DROP TABLE IF EXISTS "system_audit_events";
