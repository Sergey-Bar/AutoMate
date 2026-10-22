/**
 * Whether a user without a GitHub account can pull the release images.
 *
 * GHCR creates a package **private** the first time it is pushed, and only the owner can
 * make it public — in the package's settings, once; no workflow token can. A release whose
 * images are private installs for its author and fails for everybody else with `denied`,
 * so the release workflow asks the registry anonymously, the way `docker pull` on a
 * stranger's machine would, and stops before publishing if any image refuses.
 */

/**
 * @typedef {{ image: string, status: number | string }} PullCheck
 */

/** @param {string} owner @param {string} image @returns {string} */
export function packageSettingsUrl(owner, image) {
  return `https://github.com/users/${owner}/packages/container/package/${image}/settings`;
}

/**
 * Ask GHCR, anonymously, for one image's manifest.
 *
 * @param {string} owner lower-case namespace, for example `sergey-bar`
 * @param {string} image for example `automate-api`
 * @param {string} tag
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<PullCheck>}
 */
export async function anonymousPull(owner, image, tag, fetcher = fetch) {
  const repository = `${owner}/${image}`;
  try {
    const tokenResponse = await fetcher(
      `https://ghcr.io/token?scope=repository:${repository}:pull&service=ghcr.io`,
    );
    if (!tokenResponse.ok) return { image, status: tokenResponse.status };
    const { token } = /** @type {{ token?: string }} */ (await tokenResponse.json());
    const manifest = await fetcher(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
      method: 'HEAD',
      headers: {
        authorization: `Bearer ${token ?? ''}`,
        accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
        ].join(', '),
      },
    });
    return { image, status: manifest.status };
  } catch (error) {
    return { image, status: `unreachable (${String(error)})` };
  }
}

/**
 * What to tell the release owner, one line per image that a stranger cannot pull.
 *
 * @param {string} owner
 * @param {PullCheck[]} checks
 * @returns {string[]}
 */
export function visibilityProblems(owner, checks) {
  return checks
    .filter((check) => check.status !== 200)
    .map(
      (check) =>
        `${check.image}: an anonymous pull answered ${String(check.status)}. If this is the ` +
        'first release, the package is private: open ' +
        `${packageSettingsUrl(owner, check.image)} → Change visibility → Public, then re-run ` +
        'the failed jobs.',
    );
}
