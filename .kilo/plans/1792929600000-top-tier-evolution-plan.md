# Top-tier evolution: health, LAN server, scheduled reports, calm UX

Decided with the repository owner on 2026-10-25: consolidate the gates and then build;
an ADHD-friendly product and reports; a hardened LAN server on Linux and Windows; a flat,
Tesla-minimal design (no glass — `GLASS_SELECTOR` and the design language unchanged).

## Phase A — health without bloat

1. **Each check runs once.** `verify` went from 17 to 13 steps (474 s to 345 s on the
   reference host). `scripts/lib/gate-duplication.mjs` expands the chain and
   `gate-duplication.test.mjs` fails on repeated work. CI dropped the duplicate contract,
   runner, docs, licence, audit and secret-scan steps.
2. **Supply chain.** Grouped weekly Dependabot minor/patch updates with a cooldown;
   `.github/workflows/scorecard.yml`; a CycloneDX SBOM attached to each release.

## Phase B — LAN server

3. `checkExposurePolicy` and the start scripts refuse a reachable install with no login;
   `AUTOMATE_LAN_MODE=1` turns enforcement on. Ledger LAN-1 (forged XFF), LAN-2 (cookie
   Secure), LAN-3 (unguarded routes).
4. `apps/api/src/http/route-access.ts` guards every route; `PUBLIC_ROUTES` is the open set.
   Cross-site mutating requests are refused (`middleware/origin-check.ts`).
5. HTTPS: `start lan-cert` issues a local CA and server certificate inside the edge image;
   the edge serves 8443 with HSTS and redirects 8080. `site/guide/lan-mode.md` covers CA
   trust per OS and firewall commands.
6. Device pairing (`pairing_codes`, `0033`) and `ALLOWED_CLIENT_CIDRS`.
7. Remote runners refuse plain HTTP to another machine. Discovery relies on the OS's own
   `<hostname>.local`; no responder is shipped, because Docker Desktop cannot pass
   multicast from its VM.

## Phase C — scheduled reports

8. `packages/reporting/src/report.ts`: one model, rendered for Slack, Teams, Telegram and
   plain text; property suite DIGEST-1/2.
9. `packages/connectors/{teams,telegram,whatsapp,signal}`, tested against mocks.
10. `notification_channels`, `report_subscriptions`, `report_deliveries` (`0034`).
11. `routes/notifications.ts`, guarded viewer/operator/admin.
12. Worker queues deliveries (`pollReportSchedules`); API dispatcher sends with
    `FOR UPDATE SKIP LOCKED`.
13. `/dashboard/reports` with the built-in inbox, presets, preview, test send, history.

## Phase D — calm UX

14. `/dashboard/now` (default landing), `StatusLine`, toasts.
15. Focus mode, density, reduced motion, keyboard shortcuts and the `?` sheet.
16. Docs: `site/guide/lan-mode.md`, `site/guide/notifications.md`, AGENTS.md, README,
    CHANGELOG; e2e `tests/e2e/product/scheduled-reports.spec.ts`.

## Not verified on the development host

- The edge image build and a TLS handshake (Docker was not running); the certificate
  script was exercised with local openssl.
- The Playwright suites (they need PostgreSQL); CI runs them.
- Real deliveries to the five platforms (no accounts); adapters are tested against mocks.
