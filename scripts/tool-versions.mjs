/**
 * The scanners `pnpm security:static` invokes, pinned to an exact artefact.
 *
 * Both tools are installed by `scripts/install-security-tools.mjs` rather than by a
 * GitHub Action. The reason is that `security:static` treats an absent scanner as a
 * failure, which is the right default but means the install has to be part of the
 * gate rather than a separate concern: a third-party action that failed to install
 * would have to be diagnosed from its own logs, with the gate simply reporting a
 * missing tool. Doing the install in-repo puts the version and the checksum where a
 * reviewer reads them, and makes `pnpm security:static` behave identically on a
 * developer machine and in CI.
 *
 * A pinned version without a checksum leaves the supply chain unpinned in the only
 * sense that matters: a re-uploaded release asset would be installed silently. So
 * `GITLEAKS_SHA256` is the value from the release's own `checksums.txt`, and the
 * installer refuses to proceed if the download disagrees.
 *
 * `SEMGREP_VERSION` carries no checksum because it is installed from PyPI, which
 * resolves and verifies the wheel's own hash.
 *
 * `scripts/install-security-tools.mjs` refuses to run from a working directory that
 * is not this repository, so a copy of this file cannot be made to install something
 * else. See the guard there for the reasoning.
 */

/** PyPI version of semgrep. */
export const SEMGREP_VERSION = '1.145.0';

/** gitleaks release tag, without the leading `v`. */
export const GITLEAKS_VERSION = '8.30.1';

/**
 * From `gitleaks_8.30.1_checksums.txt` in that release, for the Linux x64 tarball.
 * The installer computes the same digest over the bytes it received and fails on a
 * mismatch, so a substituted asset cannot be installed.
 */
export const GITLEAKS_SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';

/** Where the gitleaks release publishes its assets. */
export const GITLEAKS_RELEASE_BASE = 'https://github.com/gitleaks/gitleaks/releases/download';

/**
 * The asset name for a platform, or null when this platform has no published build.
 *
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @returns {string | null}
 */
export function gitleaksAssetName(platform, arch) {
  const key = `${platform}/${arch}`;
  /** @type {Record<string, string>} */
  const assets = {
    'linux/x64': `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    'linux/arm64': `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
    'darwin/x64': `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
    'darwin/arm64': `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
    'win32/x64': `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`,
  };
  return assets[key] ?? null;
}

/** The PyPI requirement string for the pinned semgrep. */
export const SEMGREP_REQUIREMENT = `semgrep==${SEMGREP_VERSION}`;
