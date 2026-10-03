/**
 * The icon set, and why it is a list rather than a re-export.
 *
 * **The dependency has to live in exactly one package.** `lucide-react` is a
 * dependency of `@automate/ui` and not of `apps/web`, which pnpm's isolated
 * `node_modules` means an application component *cannot* import it — the first
 * version of `ThemeToggle` did exactly that and failed to resolve. Rather than add
 * a second dependency edge so a handful of files could draw a triangle, the icons
 * are exported from the package that already owns them.
 *
 * **A named list, not `export * from 'lucide-react'`.** Re-exporting the library
 * would make all sixteen hundred of them part of this package's public API, which
 * means a component reaching for `Wrench` would look like a deliberate choice when
 * it is just a name that happened to be in scope. A list is a decision, and it is
 * also what stops an icon — or an emoji — arriving one name at a time in whatever
 * component wanted it: adding one is a line in this file, which is the one place the
 * choice is made.
 *
 * **Only what is drawn.** Every name here is used by a component in this package or
 * in `apps/web`. A speculative icon is a name that looks available and gets used
 * without anyone deciding whether it is the right shape, which is the same failure
 * the list is meant to prevent.
 *
 * Names are the current lucide names. `AlertTriangle` is gone upstream in favour of
 * `TriangleAlert`, and `TrendingRight` does not exist, so a flat trend is `Minus` —
 * a trend that did not move is not a rightward trend.
 *
 * Every icon is rendered `aria-hidden` by its caller and paired with a name, because
 * the glyphs they replace were text with no name: a shape with neither an accessible
 * name nor a consistent appearance across platforms.
 */
export {
  /** Sort direction, ascending. Replaces `▲`, a geometric shape rather than a glyph. */
  ArrowUp,
  /** Sort direction, descending. Replaces `▼`. */
  ArrowDown,
  /** A metric that did not move. Replaces an em dash. */
  Minus,
  /** The `system` theme: whatever the operating system says. */
  Monitor,
  /** The `dark` theme. */
  Moon,
  /** The `light` theme. */
  Sun,
  /** The sidebar is expanded; the control collapses it. Replaces the word "Collapse". */
  PanelLeftClose,
  /** The sidebar is collapsed; the control expands it. Replaces `›`. */
  PanelLeftOpen,
  /** `StatCard` trend up. Replaces `↑`. */
  TrendingUp,
  /** `StatCard` trend down. Replaces `↓`. */
  TrendingDown,
} from 'lucide-react';
