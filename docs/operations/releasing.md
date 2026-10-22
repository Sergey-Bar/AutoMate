# Releasing

A release is a tag. Pushing `vX.Y.Z` runs `.github/workflows/release.yml`, which builds
and publishes the images, creates the GitHub release with the downloadable bundle, and
installs that bundle on a clean runner to prove it works. The decision is
[ADR-013](../adr/013-published-images-and-a-release-bundle.md).

## Steps

1. **Release PR.** Bump `version` in the root `package.json` and add a
   `## X.Y.Z — <date> — <title>` section to `docs/CHANGELOG.md`. That section is the
   release notes, word for word. Merge it like any other PR.
2. **Tag the merge commit** and push the tag:

   ```bash
   git fetch origin
   git tag -a vX.Y.Z -m "vX.Y.Z" origin/main
   git push origin vX.Y.Z
   ```

3. **Watch the `Release` workflow.** Its jobs, in order:

   | Job                           | What it does                                                                                                        |
   | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
   | Prepare                       | Refuses a tag that is not `v<semver>`, a `package.json` with another version, or a changelog with no section for it |
   | Verify                        | `pnpm verify` on the tagged commit                                                                                  |
   | Image …                       | Builds each image natively on amd64 and arm64, with an SBOM and provenance                                          |
   | Publish …                     | Tags one multi-arch image `X.Y.Z` (+ `X.Y` and `latest` for a final release) and attests it                         |
   | Images are public             | Pulls every image anonymously; stops if one is private                                                              |
   | GitHub release                | Builds `automate-X.Y.Z.zip` and `SHA256SUMS` and publishes the release                                              |
   | Install from the release page | Downloads the zip, checks the checksum, runs `start.sh`, signs in, removes it                                       |

## The first release: make the packages public

GHCR creates every package **private** the first time it is pushed, and no workflow can
change that. On the first release the **Images are public** job fails and prints one
settings link per image. For each `automate-*` package: **Package settings → Change
visibility → Public**. Then **Re-run failed jobs** on the workflow run. Later releases
push to the same packages and stay public.

## A release candidate

`vX.Y.Z-rc.N` runs the same workflow. Its images get only the `X.Y.Z-rc.N` tag — never
`X.Y` or `latest` — and the GitHub release is marked as a prerelease. Its notes are the
`X.Y.Z` changelog section, so write that section first.

## What a release does not check

The acceptance job installs on Linux amd64. GitHub's Windows runners run Windows
containers only and its macOS runners have no Docker, so neither can start the Linux
images; the job summary lists both as GAPs. `start.ps1` and `start.cmd` are tested on a
Windows runner against a fake `docker` (`Start scripts on Windows` in Unified CI).
