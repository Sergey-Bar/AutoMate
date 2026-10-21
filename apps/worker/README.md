# @automate/worker

The background loop: it reaps expired leases (requeuing or ending the run), enqueues due schedules, and reports readiness. Leases are fenced, claims use `FOR UPDATE SKIP LOCKED`, and the tenant of a scheduled run comes from its `workspace_id` column rather than from its JSON payload.

```bash
pnpm --filter @automate/worker test
```

Part of the [Automate](https://github.com/Sergey-Bar/AutoMate) monorepo; see the root README for the whole picture.
