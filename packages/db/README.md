# @automate/db

The Drizzle schema and the journal-ordered PostgreSQL migration graph in `drizzle/`. `pnpm db:check` verifies the journal and the schema agree; integration suites apply this graph to PGlite.

```bash
pnpm db:check
```

Part of the [Automate](https://github.com/Sergey-Bar/AutoMate) monorepo; see the root README for the whole picture.
