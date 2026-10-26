/**
 * Every environment variable the CLI reads, by name, in one place — so what it reads is a list
 * a reviewer can see rather than "whatever is in `process.env`", and nothing else in the
 * environment reaches a command.
 */
export function readEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    AUTOMATE_URL: process.env['AUTOMATE_URL'],
    AUTOMATE_TOKEN: process.env['AUTOMATE_TOKEN'],
    AUTOMATE_PROJECT: process.env['AUTOMATE_PROJECT'],
    AUTOMATE_BRANCH: process.env['AUTOMATE_BRANCH'],
    AUTOMATE_COMMIT: process.env['AUTOMATE_COMMIT'],
    // GitHub Actions' own, so a step on Actions needs no flags for the branch and commit.
    GITHUB_HEAD_REF: process.env['GITHUB_HEAD_REF'],
    GITHUB_REF_NAME: process.env['GITHUB_REF_NAME'],
    GITHUB_SHA: process.env['GITHUB_SHA'],
    GITHUB_WORKSPACE: process.env['GITHUB_WORKSPACE'],
    GITHUB_RUN_ID: process.env['GITHUB_RUN_ID'],
    GITHUB_RUN_ATTEMPT: process.env['GITHUB_RUN_ATTEMPT'],
  };
}
