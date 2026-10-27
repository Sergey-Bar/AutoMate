# Choose a profile

One install serves one person or a whole organisation. A **profile** sets the defaults for
who may reach it and how they sign in; every default can still be changed on its own, and a
combination that contradicts itself refuses to start and says which setting to change.

| You are                                             | Profile      | Who can reach it                   | How people sign in                                        |
| --------------------------------------------------- | ------------ | ---------------------------------- | --------------------------------------------------------- |
| One developer, on your own machine                  | `solo`       | This machine only                  | Nobody signs in: you are the operator                     |
| A small team on one network, or remote              | `startup`    | Your network, or Cloudflare Tunnel | Access tokens, paired devices, Cloudflare Access          |
| Several teams sharing one install                   | `team`       | Cloudflare Tunnel or a proxy       | Single sign-on with OIDC, a role per person               |
| An organisation with an identity provider, auditors | `enterprise` | Cloudflare Tunnel or private       | Single sign-on only; break-glass for the installation key |

Set it with the start script, in the folder you unpacked the release into. Your data and
secrets are kept when you change it.

```sh
./start.sh --profile team
```

```powershell
.\start.cmd --profile team
```

The Deployment page in the app (_Map → Deployment_) shows the profile the install is running
and what to do next.

## Solo

Nothing to configure. `./start.sh` binds to `127.0.0.1`, and anything that tries to make the
install reachable from another machine — `AUTOMATE_BIND=0.0.0.0`, LAN mode, a tunnel — is
refused with the profile to use instead.

## Startup

Turns sign-in on. Then pick how people reach it:

- **Same network:** [LAN mode](/guide/lan-mode) — `AUTOMATE_BIND=0.0.0.0`, a LAN certificate,
  and device pairing from the Access page.
- **Anywhere:** [Cloudflare Tunnel and Access](/guide/remote-cloudflare) —
  `./start.sh --profile startup --remote cloudflare`. No router port is opened.

Issue access tokens with a role (`viewer`, `operator`, `admin`) from the Access page, and an
`uploader` token for CI.

## Team

Adds people. Register Automate with your identity provider (Google, Microsoft Entra, Okta,
GitHub through an OIDC bridge, or any OpenID Connect provider) as a **confidential web
application** with the redirect URI `https://<your host>/api/v1/auth/oidc/callback`, then:

```sh
OIDC_ISSUER=https://login.example.com
OIDC_CLIENT_ID=automate
OIDC_CLIENT_SECRET=...
OIDC_ALLOWED_DOMAINS=example.com
OIDC_ROLE_MAP=admin:ana@example.com,operator:group:qa
OIDC_DEFAULT_ROLE=viewer          # or none, to admit only the people the map names
AUTOMATE_PUBLIC_URL=https://automate.example.com
```

The sign-in screen then shows _Sign in with single sign-on_. A person's role is per
workspace; the map is the same grammar as Cloudflare Access's `CF_ACCESS_ROLE_MAP`, and it is
applied at every sign-in, so a change in your identity provider takes effect the next time
someone signs in.

## Enterprise

Everything in `team`, plus:

- **Single sign-on is enforced.** The installation key and pasted tokens no longer sign a
  browser in; tokens sent by CI keep working. The install refuses to start without OIDC or
  Cloudflare Access configured, because otherwise nobody could sign in.
- **SAML** goes through Cloudflare Access: add your SAML identity provider to Zero Trust, and
  map its groups with `CF_ACCESS_ROLE_MAP=admin:group:automate-admins`. Automate verifies the
  token Cloudflare signs, so there is no XML signature handling in the app.
- **Break-glass.** If single sign-on is down, set `AUTOMATE_BREAK_GLASS=1` and restart: the
  installation key works again, every use is logged and written to the audit trail, and the
  start-up log says it is on. Turn it off once you are back in.
- **An audit trail an auditor accepts.** Every decision is a row chained to the one before it,
  and the table refuses edits. Admins read it, check it and export it on _Map → Audit_ (or at
  `GET /api/v1/audit`, `/audit/verify` and `/audit/export`), and `pnpm audit:verify` checks it
  against the database. Keep the head hash of each export somewhere else: it is what proves
  later that the trail was not rewritten from that point.
- **Provisioning with SCIM.** Issue a SCIM token (`POST /api/v1/scim-tokens`, as an admin) and
  give your identity provider the base URL `https://<your host>/scim/v2` and that token. Assign
  people to the `automate-viewer`, `automate-operator` or `automate-admin` groups to set their
  role. Deactivating someone in the identity provider signs them out of Automate at once. Behind
  Cloudflare Access, add a _Bypass_ policy for the path `/scim/v2`: the SCIM token is the
  credential there.

People who signed in appear on _Map → Members_, where an admin changes a role, disables someone
or removes them. The last admin of a workspace cannot be removed.

## Moving up a profile

1. `./start.sh backup` — a copy of the database, the stored artifacts and `.env`.
2. Add the settings the next profile needs (sign-in for `startup`, OIDC for `team`).
3. `./start.sh --profile <next>`.

Nothing is migrated by hand: the data stays where it is, and the people who sign in with
single sign-on get their roles on first sign-in.

## What is not built yet

Several workspaces per install are on the plan and not yet available: an install has one
workspace (`WORKSPACE_ID`). Telemetry export is also still to come. The
[capability register](/pages/capabilities) is the list of what is, with the test behind each
row.
