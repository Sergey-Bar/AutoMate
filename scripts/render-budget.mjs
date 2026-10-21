/**
 * `pnpm test:render` — measure the four primary routes against the built bundle.
 *
 * A wrapper rather than a bare `playwright test --project=rendering-budget`, because
 * the measurement needs the web bundle built first and served by `vite preview`. See
 * `scripts/lib/render-run.mjs` for why, and for why the build is not part of the
 * Playwright web server command.
 */
import { runRenderBudget } from './lib/render-run.mjs';

process.exit(runRenderBudget());
