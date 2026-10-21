# @automate/unified-web

The web console: React 19, TanStack Router file routes in `src/routes`, and Tailwind CSS 4 on the `@automate/ui` component library. Data comes from hand-written fetch wrappers in `src/lib/api.ts`, parsed with Zod and consumed by hooks in `src/hooks`. Every route is swept by axe in both themes by the end-to-end suite.

```bash
pnpm --filter @automate/unified-web dev
```

Part of the [Automate](https://github.com/Sergey-Bar/AutoMate) monorepo; see the root README for the whole picture.
