import React from 'react';
import { Navigate, createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  // `path: '/'` is required by this app's file-based route generation: a child of
  // the root with *no* path is generated as a second `__root__` and the tree
  // throws "Duplicate routes found with id: __root__" at import.
  //
  // It has a known cost, recorded here because it was found rather than designed:
  // `/` matches this route and the root, and `<Navigate>` re-runs matching on
  // every navigation. On an idle machine React settles before it matters. Under
  // `pnpm test`, with thirty-odd package suites competing, it reached React's
  // maximum update depth and `router.test.tsx` failed — on a `waitFor` that
  // reported a timeout rather than the loop underneath it.
  //
  // Moving the redirect into the root's `beforeLoad` would make it a
  // navigation-time decision instead of a render, which cannot loop. That is the
  // fix; it is not landed here because it changes the root route that the login
  // and dashboard tests share, and a routing change deserves to be verified on
  // its own rather than inside an unrelated commit.
  path: '/',
  component: () => <Navigate to="/dashboard" />,
});
