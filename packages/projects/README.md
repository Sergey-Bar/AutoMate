# @automate/projects

The project registry's pure half: ecosystem and test-tool detection over a repository view, the declared-config merge, the repository scan and the QA health score. It holds no database or filesystem handle, so it runs the same in the API, a rehearsal and a fixture test.

```bash
pnpm --filter @automate/projects test
```

Part of the [Automate](https://github.com/Sergey-Bar/AutoMate) monorepo; see the root README for the whole picture.
