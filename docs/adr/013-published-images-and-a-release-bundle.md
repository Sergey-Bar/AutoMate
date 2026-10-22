# ADR-013: Releases publish multi-arch images and a one-download bundle

**Status:** accepted
**Date:** 2026-10-22
**Supersedes:** —

## Context

[ADR-006](./006-single-node-single-tenant-self-hosted.md) makes the product a self-hosted
install of one compose file on one machine. Until this record, that compose file built
every image from source on the machine that ran it: a user had to clone the monorepo,
install nothing less than the whole toolchain into seven images (2.3–4.7 GB each), fill in
eleven values by hand, and — as ledger MNT-19 to MNT-23 recorded — could not have started
the result anyway. Nothing was published, so `oci:verify` could never compare a registry
digest, and a release was a tag and a hand-written `gh release create`.

## Decision

Every `v*` tag runs `.github/workflows/release.yml`, which:

1. refuses a tag whose version is not in `package.json` or has no `docs/CHANGELOG.md`
   section, then runs `pnpm verify`;
2. builds each image in `PUBLISHED_IMAGES` (`scripts/lib/release-compose.mjs`) natively on
   amd64 and arm64 runners and publishes one multi-arch image per service to
   `ghcr.io/sergey-bar/automate-<service>`, tagged `X.Y.Z` — and `X.Y` and `latest` only for
   a final release — with an SBOM and a build-provenance attestation;
3. stops if any image cannot be pulled anonymously (`pnpm release:visibility`);
4. publishes a GitHub release whose notes are the changelog section and whose assets are
   `automate-X.Y.Z.zip` and `SHA256SUMS` (`pnpm release:bundle`);
5. installs that zip from the release page on a clean runner, probes it, and removes it.

The zip carries a compose file **derived** from `infra/compose/docker-compose.unified.yml`
(every `build:` replaced by the published image), so the repository keeps one compose
authority, plus `start.sh`, `start.ps1` and `start.cmd`. The start scripts generate the
secrets once, keep them, and bind to loopback unless told otherwise.

## Consequences

- **A user needs Docker and nothing else**, on Windows, macOS or Linux, amd64 or arm64.
- **ADR-006 holds unchanged:** one node, one tenant, self-hosted. This record changes how
  the install is distributed, not what it is.
- **A first release needs one manual step:** GHCR creates each package private and only
  the owner can make it public. The workflow detects it and names each settings page.
- **The install is open by default** (no login, ADR-006), which is why the published port
  binds `127.0.0.1` and the start scripts warn when `AUTOMATE_BIND` is anything else.
- **The acceptance job covers Linux amd64 only.** GitHub's Windows runners run Windows
  containers and its macOS runners have no Docker; the job summary records both as GAPs,
  and `start.ps1` / `start.cmd` are tested against a fake `docker` on a Windows runner.

## Evidence

- `.github/workflows/release.yml` and `scripts/lib/release-workflow.test.mjs`.
- `scripts/lib/release-compose.mjs`, `scripts/lib/release-bundle.mjs` and their tests.
- `infra/release/start.sh`, `start.ps1`, `start.cmd` and `scripts/lib/start-scripts.test.mjs`.
- `scripts/compose-boot.mjs` — the `Compose boot` job, which starts the source stack from
  nothing on every pull request.
