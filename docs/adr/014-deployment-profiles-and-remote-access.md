# ADR-014: Deployment profiles, remote access through Cloudflare, and identity in layers

**Status:** accepted
**Date:** 2026-10-27
**Supersedes:** — (amends [ADR-006](./006-single-node-single-tenant-self-hosted.md) on identity and exposure only)

## Context

[ADR-006](./006-single-node-single-tenant-self-hosted.md) made the product one node, one
tenant, self-hosted, with one operator and no login. LAN mode later added sign-in, token
roles, device pairing and a client allowlist for a shared network. That covers one person
and a small room. It stops being useful as a team grows:

- one workspace per install, fixed by the `WORKSPACE_ID` environment variable;
- no user accounts, so a role belongs to a token rather than to a person;
- no single sign-on, no provisioning and no audit export;
- no safe way to reach the install from outside the network it runs on.

The product should be useful at every size — one developer, a startup, a team, an
enterprise — without becoming a hosted service or a second product.

## Decision

**One self-hosted MIT product with four deployment profiles**, selected by
`AUTOMATE_PROFILE` and defaulting to `solo`. A profile only sets defaults; any setting can
be overridden, and a combination that contradicts itself is refused at startup, by name, in
`checkExposurePolicy` (`apps/api/src/startup-policy.ts`) — the one place the exposure rule
already lives. There is no licence key and no edition split.

| Profile      | Access control | Exposure              | Identity                                         | Workspaces |
| ------------ | -------------- | --------------------- | ------------------------------------------------ | ---------- |
| `solo`       | open           | loopback only         | none                                             | 1          |
| `startup`    | enforced       | LAN or Cloudflare     | tokens, device pairing, Cloudflare Access        | 1          |
| `team`       | enforced       | Cloudflare or a proxy | + users, OIDC sign-in, per-workspace roles       | many       |
| `enterprise` | enforced       | Cloudflare or private | + SAML via Cloudflare Access, SCIM, SSO enforced | many       |

**A tunnel is exposure.** Cloudflare Tunnel dials out, so an install bound to `127.0.0.1`
becomes reachable from the internet without its bind changing. The bind check cannot see
that, so `AUTOMATE_REMOTE=cloudflare` is its own refusal: it requires enforced access
control and both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`, and `solo` refuses it.

**The credential order** — one resolver, `callerOf` in `apps/api/src/http/roles.ts`:

1. an access token (bearer or the `automate_token` cookie);
2. a user session;
3. a verified `Cf-Access-Jwt-Assertion`, only with `AUTOMATE_REMOTE=cloudflare`;
4. the installation session (admin), which is break-glass only under enforced SSO;
5. access control `open`: the anonymous operator ADR-006 describes;
6. otherwise nobody.

**Several workspaces per install.** The workspace comes from each request — a token's own
workspace, or a user's membership — and `WORKSPACE_ID` becomes the default. `WORKSPACE_ID`
stays the only tenancy _boundary_: there is still no row-level security, and every
workspace-scoped read or write still needs a cross-workspace isolation test.

**SAML only through Cloudflare Access.** Cloudflare speaks SAML to the identity provider and
the application verifies a JWT, so there is no XML signature handling in this codebase. The
dormant `saml_config` table stays dormant. Direct SAML is deferred, with a removal condition:
_a customer whose identity provider cannot be fronted by Cloudflare Access_.

**OIDC through `openid-client` v6**, pinned in the `catalog:` block.

## Consequences

- **ADR-006 holds on everything it does not mention here:** one node, self-hosted, English
  only. The enterprise operations guidance is a documented single-node posture with external
  managed Postgres and object store, not a cluster.
- **Real-provider evidence is not claimed.** No Cloudflare account or identity-provider
  tenant has been confirmed for this repository, so the tunnel, Access, OIDC and SCIM paths
  are proven against in-process fakes with keys generated at runtime. Any capability-register
  row that needs a real provider stays `not_configured` and names the command that would
  decide it.
- **The workspace move is the largest change in the plan.** It was first planned behind a
  ratchet that moved every store to request scope. It landed instead (2026-10-27) as **one
  composition per workspace**, built by the same factory, with a dispatch that forwards a
  request to its workspace's composition. The workspace is read only from a credential the
  server trusts. Every store keeps the construction-time binding that the isolation tests
  already reason about, so no per-request value can be missed, and no ratchet is needed.
  Runners are one pool the installation shares.
- **`solo` behaves exactly as an install did before this record.** No variable is required
  that was not required before.

## Evidence

- `packages/config/src/config.ts` — `AUTOMATE_PROFILE`, the profile defaults, and the remote
  settings.
- `apps/api/src/startup-policy.ts` and `apps/api/src/startup-policy.test.ts` — the refusals.
- `apps/api/src/http/roles.ts` — the credential order.
- `apps/api/src/http/cloudflare-access.ts`, `apps/api/src/http/cloudflare-access.test.ts` and
  the property suite beside it — the Access verifier and the role map.
- `packages/config/src/remote.ts` — the tunnel settings, validated at startup.
- `apps/api/src/routes/oidc.ts` and `apps/api/src/services/user-service.ts` — OIDC sign-in and
  per-workspace roles.
- `packages/db/drizzle/0050_audit_chain.sql` and `apps/api/src/routes/audit.ts` — the
  append-only audit chain, its export and its verification.
- `apps/api/src/routes/auth.ts` — enforced single sign-on and break-glass.
- `apps/api/src/http/workspace-dispatch.ts`, `apps/api/src/http/workspace-lookups.ts` and
  `apps/api/src/routes/workspaces.ts`, each with its test — several workspaces per install.
- `apps/api/src/routes/members.ts` and `apps/api/src/routes/scim.ts` — member management and
  SCIM provisioning.
- `infra/release/start.sh`, `infra/release/start.ps1` and `scripts/lib/start-scripts.test.mjs`
  — the start scripts repeat the refusals before anything starts.
- The plan of record: `.kilo/plans/1793102400000-profiles-and-remote-plan.md`.
