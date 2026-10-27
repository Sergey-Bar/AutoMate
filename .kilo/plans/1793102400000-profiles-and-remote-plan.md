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
