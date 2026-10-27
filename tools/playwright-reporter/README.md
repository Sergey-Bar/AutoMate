# @automate/playwright-reporter

A Playwright reporter that streams a run into AutoMate while it runs. Each test shows up on the run page as soon as it finishes. When an attempt fails, its trace, screenshot and video are uploaded too. The package has no runtime dependencies. MIT.

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['list'], ['@automate/playwright-reporter']],
});
```

| Variable                   | Meaning                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `AUTOMATE_URL`             | The AutoMate origin. `https://`, or `http://` only to a loopback host. |
| `AUTOMATE_REPORTER_SECRET` | The install's `REPORTER_SECRET`. It is read from the environment only. |
| `AUTOMATE_BRANCH`          | Optional. Falls back to `GITHUB_HEAD_REF`, then `GITHUB_REF_NAME`.     |
| `AUTOMATE_COMMIT`          | Optional. Falls back to `GITHUB_SHA`.                                  |

Options, passed as `['@automate/playwright-reporter', { … }]`:

- `url`: overrides `AUTOMATE_URL`.
- `uploadArtifacts`: defaults to `true`.
- `maxArtifactBytes`: defaults to 64 MiB, which is the server's own limit.

What it does:

- **It never fails your run.** If AutoMate is down, a request is retried three times, the reporter prints one line to stderr, and the tests carry on.
- **One result per test.** A test that passes on a retry is reported as `flaky`. Outcomes are honoured, so a `test.fail()` that fails counts as a pass.
- **Test identity matches uploaded reports.** Identity is built from the file (relative to `rootDir`, as Playwright's JSON reporter writes it), the `describe` path, the title and the project. A test therefore keeps one history whichever way its results arrive.

**Artifacts need database mode.** In database mode the reporter's runs and the execution store's runs are the same table, so uploads can be attached to the run. An in-memory development install answers artifact uploads with `404`.

**For the CI gate, use `automate test` from `@automate/cli`.** It uploads the finished report against a project and exits with the verdict. Quarantine and the PR comment depend on that path. A streaming reporter cannot give a verdict, because Playwright exits before the reporter could ask for one. Do not use both on the same run, or the run is recorded twice.
