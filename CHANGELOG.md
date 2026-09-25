# Changelog

> Historical release claims are not current product truth. Current capability status is `docs/migration/capability-register.md`.

## Unreleased — unified migration

- Added canonical shared contracts for reporting, realtime envelopes, orchestration, runner protocol, and installation sessions.
- Added reporting, producer-adapter, realtime, orchestration, automation-gateway, runner SDK, connector, artifact, vault, and migration-control boundaries.
- Added a forward PostgreSQL identity/outbox migration and coverage ratchet.
- Replaced the clean-checkout route boundary and centralized root governance commands.
- Removed obsolete readiness, roadmap, and migration documents from the active tree.

The migration remains local/sample-only. Production cutover, publication, credential rotation, source deletion, and destructive data migration are not authorized by this branch.
