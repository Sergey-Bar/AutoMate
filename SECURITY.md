# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting on the Security tab
(https://github.com/sergey-bar/AutoMate/security/advisories/new), or email the
maintainer directly if that route is unavailable to you.

Please include: what the affected version or commit is, what an attacker can do, the
steps to reproduce it, and what you already tried. A proof of concept is worth more
than a description.

## Response window

| Severity | First response   | Target for a fix or a mitigation |
| -------- | ---------------- | -------------------------------- |
| Critical | 2 business days  | 7 days                           |
| High     | 5 business days  | 14 days                          |
| Medium   | 10 business days | next release                     |
| Low      | 10 business days | next release                     |

"Response" means a human has read the report and told you what they think of it, not
that the fix has shipped. A vulnerability that is accepted and not yet fixed gets a
told-you-so, and a `not_configured` reason where one applies.

The three-outcome rule applies here too: if something is not done, the report says
`not_configured` with a reason rather than reporting a pass. If a fix is partial, the
partial state is the reported state.

## What is in scope

This is a self-hosted, single-tenant product. The security boundary that matters is
the one between a workspace's data and everything else, and the one between a
reporter or runner and the API.

- **Authorization.** `WORKSPACE_ID` is the only tenancy boundary in the system. Every
  workspace-scoped read or write needs a cross-workspace isolation test, and a change
  that adds one without a test is the reportable defect.
- **Secrets.** Six installation secrets are read by `@automate/config` and validated at
  startup: `COOKIE_SECRET`, `SESSION_SECRET`, `VAULT_SECRET`, `AUTOMATE_API_KEY`,
  `REPORTER_SECRET` and `RUNNER_REGISTRATION_SECRET`. A placeholder is **refused** when
  `NODE_ENV=production` — `isSecretPlaceholder` matches documented development values
  exactly, plus two cookie-secret fragments, and startup fails rather than warns. If a
  configuration carrying a placeholder starts in production, that is a reportable bug.
- **Sealed rows.** Vault ciphertext is bound to its row identity by GCM additional
  authenticated data: `aadFor` builds length-prefixed AAD and both `createCipheriv` and
  `createDecipheriv` set it, so one row's ciphertext cannot be opened as another's. A
  change that drops the AAD is a reportable defect even if nothing else changed.
- **Untrusted input.** The `x-request-id` header is attacker-controlled and flows into
  logs and persisted audit rows. `normaliseRequestId` is the only place that decides,
  and it replaces anything that is not a short identifier rather than truncating it.
  A second site deciding independently is a reportable defect.

## What is out of scope

- **Host compromise.** This product is self-hosted; an attacker who already has root on
  the box owns the database.
- **Denial of service by volume.** There is no rate limit on the run-creation path by
  design, because the product assumes a trusted operator and a machine that is not
  public. Putting it on the open internet is out of scope for this threat model — which
  is itself a thing to report if the documentation implies otherwise.
- **The `BK-1` execution engines.** Four of the five agent domains answer an explicit
  `501 NOT_CONFIGURED` naming the domain and the action. An unconfigured engine cannot
  be exploited, so this is not a vulnerability; the thing to report would be an engine
  that answers as though configured.
- **Cross-tenant access on a single-tenant install.** There is one tenant, so there is
  no cross-tenant boundary to cross. A tenancy vulnerability becomes reportable the
  moment W7 enters scope.

## What "fixed" means here

`pnpm security:secrets` and `pnpm security:secrets:history` are the dependency-free
floor, and they run in CI. `pnpm security:static` adds semgrep and gitleaks and exits
non-zero when it cannot produce a scan, because an unrun security scan is not a pass.
`AUTOMATE_HOST_SCANNERS=unavailable` records a _scanner that could not run_ as
`not_configured` — and a scanner killed at its timeout counts as unavailable, never as
clean, so a stall cannot become a green gate.

## A note on the evidence rule

Every response in this repository carries a stable `code` and a correlation id, and the
ledger at `docs/quality/findings-ledger.json` records every confirmed defect with its
evidence. A report that arrives is therefore triaged against a machine-checked record
rather than a memory, and you are welcome to ask what a given row's status is by
reading it yourself.
