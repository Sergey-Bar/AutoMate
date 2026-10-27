# Profiles and remote access: one install from solo to enterprise

Decided with the repository owner on 2026-10-27. The record is
`docs/adr/014-deployment-profiles-and-remote-access.md`, which amends ADR-006 on identity and
exposure only.

## Decisions

- One self-hosted MIT product, no licence key, no SaaS. `AUTOMATE_PROFILE=solo|startup|team|enterprise`,
  default `solo`. A profile sets defaults only; contradictions are refused in `checkExposurePolicy`.
- Remote is Cloudflare Tunnel (a `cloudflare` compose profile) plus Cloudflare Access. The
  `Cf-Access-Jwt-Assertion` header is verified against the team JWKS and is a credential source.
  A tunnel is exposure: it needs enforced access and `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`.
- Identity in layers: token roles everywhere; Cloudflare identities from `startup`; users, OIDC
  (`openid-client` v6, catalog-pinned) and per-workspace roles in `team`; SAML via Cloudflare
  Access only, SCIM, enforced SSO and a hash-chained exportable audit log in `enterprise`.
- Several workspaces per install; the workspace comes from the request and `WORKSPACE_ID` is the
  default.
- No real provider account is confirmed: everything is proven against in-process fakes with
  runtime-generated keys, and real-provider capability rows stay `not_configured`.

## Rules

- Red first: every test is run against the defect before the fix.
- A new route gets a guard or a `PUBLIC_ROUTES` row, then `pnpm authz:matrix` and `pnpm authz:check`.
- A new table gets a tenancy-register row; workspace-scoped tables use the hard-boundary pattern
  and an isolation test.
- No gate is weakened, no floor lowered.

## Tasks (tier by tier; each milestone can be released)

Milestone 0 — decision
1. ADR-014 and this plan.

Milestone 1 — solo
2. Profile resolution in `packages/config/src/config.ts` and refusals in
   `apps/api/src/startup-policy.ts`; `profile` on features and whoami; start scripts mirror it.
3. Guided first run (`start --profile`), and a deployment status page in the web app.
4. Backup and restore with a manifest; restore refuses a newer migration head or a bad digest.

Milestone 2 — startup
5. Cloudflare Access JWT verifier (RS256, aud, iss, exp, nbf, JWKS cache, refetch on unknown kid).
6. Cloudflare as a credential source in `callerOf` (`apps/api/src/http/roles.ts`), with a role map.
7. The `cloudflared` compose service, `start --remote cloudflare`, CLI service-token headers, docs.

Milestone 3 — team
8. Users and membership schema (additive): users issuer/subject, workspace_members, invitations,
   workspace slug, session user.
9. Per-request workspace scope middleware and a ratchet over composition-root-bound sites.
10. Runs, execution, artifacts and quality gates move to request scope.
11. Projects, health, reporting, delivery, vault and connectors move to request scope.
12. Realtime, SSE, worker and runner move to request scope; the ratchet becomes a hard test.
13. Workspace and member management (API and UI).
14. OIDC sign-in.

Milestone 4 — enterprise
15. Audit trail completion, hash chain, `audit:verify`, read and export routes; `status:10` point 8.
16. SAML through Cloudflare Access group mapping, enforced SSO, break-glass.
17. SCIM 2.0 provisioning with a `scim-token` guard class.
18. OTLP telemetry, scheduled backups, the single-node enterprise operations guide.

Milestone 5 — together
19. Profile-matrix E2E (pr-reporting until three stable runs) and capability rows.
20. Which-profile docs, a quickstart per profile, moving up a profile, an honest comparison.

## Progress

Recorded here as tasks land, so the next session reads the state from the tree.

- 2026-10-27 — Milestone 0: ADR-014 accepted.
- 2026-10-27 — Milestone 1: profiles in `packages/config/src/profiles.ts`, refusals in
  `apps/api/src/startup-policy.ts`, `profile` on whoami and features, the web Deployment page,
  `start --profile`, `start backup` and `start restore` in both shells.
- 2026-10-27 — Milestone 2: the Access verifier and caller source in
  `apps/api/src/http/cloudflare-access.ts`, remote settings in `packages/config/src/remote.ts`,
  the `cloudflared` compose service, `start --remote cloudflare`, CLI service-token headers, and
  the remote access guide. No real Cloudflare run is recorded.
- 2026-10-27 — Milestone 3, partly: `0049_workspace_members.sql` (users issuer/subject,
  `workspace_members`, `invitations`, `sessions.user_id`) and OIDC sign-in
  (`apps/api/src/routes/oidc.ts`, `apps/api/src/services/user-service.ts`, the SSO button).
  **Not done: Tasks 9–13** — per-request workspace scope, moving every store to it, and
  workspace/member management. An install still has one workspace; memberships are written
  in it.
- 2026-10-27 — Milestone 4, partly: the hash-chained, append-only audit trail
  (`0050_audit_chain.sql`), `GET /api/v1/audit`, `/audit/export`, `/audit/verify`,
  `pnpm audit:verify`, `status:10` point 8 passing; enforced SSO and break-glass.
  **Not done:** the web Audit and Members pages, Task 17 (SCIM), Task 18 (OTLP, scheduled
  backups, the enterprise operations guide), Task 19 (profile-matrix E2E).
- 2026-10-27 — Task 20, partly: `site/guide/profiles.md` (choose a profile, per-profile
  quickstarts, moving up). The comparison page is not yet updated.
- 2026-10-27 — Task 13 and Task 17: member management (`apps/api/src/routes/members.ts`, add,
  role, disable, remove, last-admin refusal), SCIM 2.0 (`apps/api/src/routes/scim.ts`,
  `0051_scim_tokens.sql`, the `scim-token` guard class), and the Members and Audit web pages.
- 2026-10-27 — Tasks 9–12, by a different route than planned: **a composition per workspace**
  rather than moving every store to request scope. `buildWorkspace(workspaceId)` in
  `apps/api/src/index.ts` builds every store and route group for one workspace; the default is
  served in place and any other is built once and reached through
  `apps/api/src/http/workspace-dispatch.ts`, which reads the workspace only from a trusted
  credential (token row, job row, membership plus the chosen cookie, the installation admin's
  choice). The lookups are `apps/api/src/http/workspace-lookups.ts`, proved on the migrated
  graph. Why: every store is bound at construction and every isolation test reasons about
  that binding; threading a request value through ~600 sites risked a missed filter. The
  ratchet in Task 9 is therefore not needed. Runners are one shared pool (`sharedRunners`).
  Workspace listing, choosing and creating (`apps/api/src/routes/workspaces.ts`) and the
  switcher on the Deployment page complete Task 13. `REPORTER_SECRET` uploads land in the
  default workspace. No run against a real PostgreSQL with two workspaces is recorded.
- Still open: Task 18 (OTLP, scheduled backups, the enterprise operations guide), Task 19
  (profile-matrix E2E), and the comparison page in Task 20.
- 2026-10-27 — Task 18: the API's request traces over OTLP/HTTP JSON
  (`apps/api/src/observability/otlp-traces.ts`, no SDK: one server span per request, named by
  the route pattern, bounded queue, off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set);
  `start backup --keep N` in both shells, for a scheduled job; and the enterprise operations
  guide (`site/guide/operations-enterprise.md`). Writing the guide found two shipped-stack
  defects, both fixed with a test derived from the source of truth: the API container never
  received the OIDC and enforced sign-on settings (`PRO-1`), and the edge proxy sent
  `/scim/v2` to the web container (`PRO-3`). No run against a real collector is recorded.
- 2026-10-27 — Task 20: the comparison page names what is built for teams and enterprises,
  and what was proven only against in-process stand-ins.
- Still open: Task 19 (profile-matrix E2E, `pr-reporting`), which needs a real PostgreSQL and
  the composed stack.
