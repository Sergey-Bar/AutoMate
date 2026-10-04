export * from './components/Button/Button.js';
export * from './components/Input/Input.js';
export * from './components/Select/Select.js';
export * from './components/Toggle/Toggle.js';
export * from './components/EmptyState/EmptyState.js';
export * from './lib/utils.js';
/*
 * The glass policy, and nothing else.
 *
 * There used to be a `tokens/` barrel here that also exported a `tokens` object and a
 * `tailwindPreset` carrying seven token groups. The preset had no importer anywhere in
 * the repository, and the five non-colour tables it fed — typography, spacing, radii,
 * shadows, z-index — were asserted by a test and rendered by nothing. Their scales are
 * declared in `theme.css` and asserted against the stylesheet there, and the tables are
 * gone. `colors.ts` and `motion.ts` are read directly by `theme.test.ts` and
 * `motion.test.ts`, which is where they belong.
 *
 * `glass.ts` is re-exported because it is not a value table: it is the *rules* — a
 * fill floor, two scheduled ranges, a radius ceiling and the list of `backdrop-*`
 * utilities a component may write — and `eslint.config.js`, `theme.test.ts` and
 * `theme-resolution.test.ts` all import it by name.
 */
export * from './tokens/glass.js';

export * from './components/Card/Card.js';
export * from './components/Badge/Badge.js';
export * from './components/Avatar/Avatar.js';
export * from './components/Textarea/Textarea.js';
export * from './components/Label/Label.js';
export * from './components/Stack/Stack.js';
export * from './components/Grid/Grid.js';
export * from './components/Container/Container.js';
export * from './components/AppShell/AppShell.js';
export * from './components/Splitter/Splitter.js';
export * from './components/Alert/Alert.js';
export * from './components/Dialog/Dialog.js';
export * from './components/Tooltip/Tooltip.js';

export * from './components/Table/Table.js';
export * from './components/Skeleton/Skeleton.js';
export * from './components/StatCard/StatCard.js';
export * from './components/Tabs/Tabs.js';
export * from './components/Breadcrumbs/Breadcrumbs.js';
export * from './components/CommandPalette/CommandPalette.js';
export * from './components/NavItem/NavItem.js';

export * from './components/Toast/Toast.js';
export * from './components/Drawer/Drawer.js';
export * from './components/Popover/Popover.js';
/*
 * The three primitives that were missing, added by the frontend-finish plan's W7.
 *
 * Each one is a *decision* rather than a convenience, and the decision is named at the
 * top of its own file: `DefinitionList` is the only markup that says "term, value" to a
 * screen reader; `Meter` has three states because "no measurement" is not a low value;
 * `Sparkline` shows shape and stops short of being a chart.
 */
export * from './components/DefinitionList/DefinitionList.js';
export * from './components/Meter/Meter.js';
export * from './components/Sparkline/Sparkline.js';
// The icon list. Exported so an application component can draw a shape without
// taking a second dependency edge on `lucide-react` to do it — see the header in
// `icons.ts` for the measured reason that matters here.
//
// A flat module and not `components/Icon/`, because it ships no component: it is a
// named re-export. A directory under `components/` that renders nothing makes the
// axe sweep's `covers every component directory` assertion — which finds components
// by looking for a non-test `.tsx` — ask for an accessibility case with no element
// to audit.
export * from './icons.js';
