import React from 'react';
import {
  Accessibility,
  BookOpen,
  Braces,
  Bug,
  ChartPie,
  Database,
  Eye,
  FlaskConical,
  Gauge,
  Globe,
  Hammer,
  Handshake,
  KeyRound,
  Layers,
  Package,
  Pilcrow,
  ScanSearch,
  ShieldCheck,
  Terminal,
  Workflow,
  Wrench,
} from '@automate/ui';
import type { ToolKind } from '@automate/shared-contracts';
import { Segmented } from './kit.js';

/**
 * Responsive without scrolling: the same screen at every width, recomposed rather than
 * stacked.
 *
 * ## Why tabs, and not a longer page
 *
 * A three-column screen stacked onto a phone is three screens tall, and the reader scrolls
 * past two of them to reach the third. Below the fitted breakpoint the panels become tabs
 * instead: one panel at a time, each filling the height that is left, and a pill bar that
 * names every panel so nothing is hidden behind a gesture. The page itself never scrolls.
 *
 * ## The breakpoint is the layout's, not the device's
 *
 * `FITTED_QUERY` is the width at which a screen's full grid fits side by side. Without
 * `matchMedia` (a test environment) the answer is "fitted", so the desktop composition is
 * what renders — which is also what every existing assertion was written against.
 */
export const FITTED_QUERY = '(min-width: 1280px)';

export function useMediaQuery(query: string, fallback = true): boolean {
  const read = React.useCallback(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    [query, fallback],
  );
  const [matches, setMatches] = React.useState(read);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export interface ResponsivePanel {
  id: string;
  label: string;
  node: React.ReactNode;
}

/**
 * The fitted grid at a wide width, the same panels as tabs at a narrow one.
 *
 * The chosen tab survives a resize back and forth, and an id that disappears falls back to
 * the first panel rather than to an empty body.
 */
export function Responsive({
  desktop,
  panels,
  label,
}: {
  desktop: React.ReactNode;
  panels: readonly ResponsivePanel[];
  /** Names the tab bar for a screen reader: "Dashboard sections". */
  label: string;
}): React.ReactElement {
  const fitted = useMediaQuery(FITTED_QUERY);
  const [chosen, choose] = React.useState(panels[0]?.id ?? '');
  if (fitted) return <>{desktop}</>;
  const active = panels.find((panel) => panel.id === chosen) ?? panels[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 overflow-x-auto">
        <Segmented
          label={label}
          options={panels.map((panel) => ({ value: panel.id, label: panel.label }))}
          value={active?.id ?? ''}
          onChange={choose}
        />
      </div>
      <div data-testid="responsive-panel" className="flex min-h-0 flex-1 flex-col">
        {active?.node}
      </div>
    </div>
  );
}

type IconComponent = typeof Wrench;

/** One glyph per kind of tool, shared by the toolbox and the runner. */
export const KIND_ICONS: Record<ToolKind, IconComponent> = {
  unit: FlaskConical,
  integration: Layers,
  e2e: Globe,
  coverage: ChartPie,
  'static-analysis': ScanSearch,
  types: Braces,
  formatting: Pilcrow,
  sast: ShieldCheck,
  secrets: KeyRound,
  dependencies: Package,
  performance: Gauge,
  accessibility: Accessibility,
  mutation: Bug,
  contract: Handshake,
  visual: Eye,
  ci: Workflow,
  build: Hammer,
  database: Database,
  docs: BookOpen,
  dev: Terminal,
  other: Wrench,
};

export function KindIcon({
  kind,
  size = 16,
  className,
}: {
  kind: ToolKind;
  size?: number;
  className?: string;
}): React.ReactElement {
  const Icon = KIND_ICONS[kind];
  return <Icon size={size} aria-hidden="true" className={className} />;
}
