import React from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Route as RouteIcon,
  StatusDot,
  cn,
  type DotStatus,
} from '@automate/ui';
import { LAYOUT, layoutMap } from '../../lib/map-layout.js';
import {
  traceOf,
  type MapNode,
  type MapSearch,
  type NodeStatus,
  type RepoMap as RepoMapModel,
} from '../../lib/repo-map.js';
import { Segmented } from '../kit.js';
import { useMediaQuery } from '../responsive.js';

/**
 * The repo map, drawn: HTML buttons over an SVG edge layer, and a list on a phone.
 *
 * ## Explore, then read
 *
 * - **Hover or focus** a node and its whole lineage lights up — everything upstream that
 *   feeds it and everything downstream it feeds — while the rest of the map dims.
 * - **Show blocking path** colours every edge that explains the worst news on the view.
 * - **Open** a node for its evidence and one next step.
 * - **Arrow keys** walk the map: up and down a column, left and right across columns.
 *
 * The state that matters — the view, the open node, the blocking path — is the caller's,
 * so the route keeps it in the URL and a link reopens the same picture.
 *
 * ## Nodes are buttons, edges are decoration
 *
 * Every node is a real `<button>` with a name that says its status in words, in a list per
 * column, so a screen reader walks the map as columns of named items. The SVG is
 * `aria-hidden`: an edge is a relation the trace and the detail both state in text.
 */

const STATUS_WORD: Record<NodeStatus, string> = {
  bad: 'failing',
  warn: 'warning',
  good: 'passing',
  unknown: 'not measured',
  muted: 'not a verdict',
};

const STATUS_DOT: Record<NodeStatus, DotStatus> = {
  bad: 'bad',
  warn: 'warn',
  good: 'good',
  unknown: 'unknown',
  muted: 'info',
};

const STATUS_BORDER: Record<NodeStatus, string> = {
  bad: 'border-danger',
  warn: 'border-warning',
  good: 'border-border',
  unknown: 'border-dashed border-border-strong',
  muted: 'border-border',
};

const VIEWS = [
  { value: 'flow', label: 'Flow' },
  { value: 'packages', label: 'Packages' },
] as const;

const LEGEND: ReadonlyArray<readonly [NodeStatus, string]> = [
  ['bad', 'Failing'],
  ['warn', 'Warning'],
  ['good', 'Passing'],
  ['unknown', 'Not measured'],
];

/** Room above the nodes for the column headings. */
const HEADER = 36;

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

export function RepoMap({
  map,
  state,
  onStateChange,
}: {
  map: RepoMapModel;
  state: MapSearch;
  onStateChange: (next: MapSearch) => void;
}): React.ReactElement {
  const wide = useMediaQuery('(min-width: 768px)');
  const [active, setActive] = React.useState<string | null>(null);
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  const trace = React.useMemo(() => traceOf(map, active), [map, active]);
  const blocking = React.useMemo(
    () => new Set(state.path ? map.blockingPath : []),
    [map.blockingPath, state.path],
  );
  const columns = React.useMemo(
    () => map.columns.map((_, column) => map.nodes.filter((node) => node.column === column)),
    [map],
  );
  const selected = map.nodes.find((node) => node.id === state.node);

  const register = (id: string) => (element: HTMLButtonElement | null) => {
    if (element === null) buttons.current.delete(id);
    else buttons.current.set(id, element);
  };

  const move = (node: MapNode, key: string): boolean => {
    const column = columns[node.column] ?? [];
    const index = column.findIndex((candidate) => candidate.id === node.id);
    let target: MapNode | undefined;
    if (key === 'ArrowDown') target = column[Math.min(index + 1, column.length - 1)];
    else if (key === 'ArrowUp') target = column[Math.max(index - 1, 0)];
    else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const step = key === 'ArrowRight' ? 1 : -1;
      for (let next = node.column + step; next >= 0 && next < columns.length; next += step) {
        const candidates = columns[next] ?? [];
        if (candidates.length > 0) {
          target = candidates[Math.min(index, candidates.length - 1)];
          break;
        }
      }
    } else return false;
    if (target !== undefined) buttons.current.get(target.id)?.focus();
    return true;
  };

  const nodeProps = (node: MapNode) => ({
    ref: register(node.id),
    type: 'button' as const,
    'data-node': node.id,
    'data-status': node.status,
    'data-dimmed': String(active !== null && !trace.nodes.has(node.id)),
    'aria-haspopup': 'dialog' as const,
    onClick: () => onStateChange({ ...state, node: node.id }),
    onFocus: () => setActive(node.id),
    onBlur: () => setActive(null),
    onMouseEnter: () => setActive(node.id),
    onMouseLeave: () => setActive(null),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (move(node, event.key)) event.preventDefault();
    },
    className: cn(
      'flex min-w-0 items-center gap-2.5 rounded-lg border bg-surface px-3 text-left transition-opacity duration-150 motion-reduce:transition-none hover:bg-surface-muted',
      FOCUS,
      STATUS_BORDER[node.status],
      active !== null && !trace.nodes.has(node.id) && 'opacity-40',
      selected?.id === node.id && 'ring-2 ring-accent',
    ),
  });

  const body = (node: MapNode) => (
    <>
      <StatusDot status={STATUS_DOT[node.status]} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">
          {node.label}
          <span className="sr-only">,</span>
        </span>
        <span className="block truncate text-xs text-fg-muted">
          {node.detail}
          <span className="sr-only">{`, ${STATUS_WORD[node.status]}`}</span>
        </span>
      </span>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Segmented
          label="Map view"
          options={VIEWS}
          value={state.view}
          onChange={(view) => onStateChange({ ...state, view, node: undefined })}
        />
        <button
          type="button"
          aria-pressed={state.path}
          onClick={() => onStateChange({ ...state, path: !state.path })}
          className={cn(
            'inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
            FOCUS,
            state.path
              ? 'border-danger text-danger'
              : 'border-border-strong text-fg hover:bg-surface-muted',
          )}
        >
          <RouteIcon size={16} aria-hidden="true" />
          Show blocking path
        </button>
        <ul
          data-testid="map-legend"
          aria-label="Legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted sm:ml-auto"
        >
          {LEGEND.map(([status, word]) => (
            <li key={status} className="inline-flex items-center gap-1.5">
              <StatusDot status={STATUS_DOT[status]} />
              {word}
            </li>
          ))}
        </ul>
      </div>

      {map.notice === null ? null : (
        <p
          role="status"
          data-testid="map-notice"
          className="max-w-measure shrink-0 text-pretty text-sm text-fg-muted"
        >
          {map.notice}
        </p>
      )}

      {state.path && map.pathNote !== null ? (
        <p
          role="status"
          data-testid="map-path-note"
          className="max-w-measure shrink-0 text-pretty text-sm text-fg"
        >
          {map.pathNote}
        </p>
      ) : null}

      {wide ? (
        <Canvas
          map={map}
          columns={columns}
          trace={trace}
          active={active}
          blocking={blocking}
          nodeProps={nodeProps}
          body={body}
        />
      ) : (
        <div data-testid="map-list" className="flex flex-col gap-5">
          {columns.map((nodes, column) =>
            nodes.length === 0 ? null : (
              <section key={map.columns[column]} aria-labelledby={`map-column-${String(column)}`}>
                <h3
                  id={`map-column-${String(column)}`}
                  className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted"
                >
                  {map.columns[column]}
                </h3>
                <ul className="flex flex-col gap-2">
                  {nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        {...nodeProps(node)}
                        className={cn(
                          nodeProps(node).className,
                          'min-h-14 w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                        )}
                      >
                        {body(node)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}

      <Dialog
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (open) return;
          const closed = state.node;
          onStateChange({ ...state, node: undefined });
          // Back to the node the detail was about. The dialog's own focus return goes to
          // whatever was focused when it opened, which for a shared link is the page body.
          window.setTimeout(() => {
            if (closed !== undefined) buttons.current.get(closed)?.focus();
          }, 0);
        }}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-md rounded-none"
      >
        {selected === undefined ? null : <Detail node={selected} />}
      </Dialog>
    </div>
  );
}

type NodeProps = (node: MapNode) => React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref: (element: HTMLButtonElement | null) => void;
};

function Canvas({
  map,
  columns,
  trace,
  active,
  blocking,
  nodeProps,
  body,
}: {
  map: RepoMapModel;
  columns: MapNode[][];
  trace: { nodes: Set<string>; edges: Set<string> };
  active: string | null;
  blocking: Set<string>;
  nodeProps: NodeProps;
  body: (node: MapNode) => React.ReactNode;
}): React.ReactElement {
  const layout = React.useMemo(() => layoutMap(map), [map]);
  return (
    <div
      data-testid="map-canvas"
      role="group"
      aria-label={`Repository map, ${map.view} view`}
      className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface-sunken p-6"
    >
      <div className="relative" style={{ width: layout.width, height: layout.height + HEADER }}>
        <svg
          aria-hidden="true"
          width={layout.width}
          height={layout.height}
          className="absolute left-0 overflow-visible"
          style={{ top: HEADER }}
        >
          {map.edges.map((edge) => {
            const path = layout.paths.get(edge.id);
            if (path === undefined) return null;
            const lit = trace.edges.has(edge.id);
            const onPath = blocking.has(edge.id);
            return (
              <path
                key={edge.id}
                d={path}
                data-edge={edge.id}
                data-lit={String(lit)}
                data-blocking={String(onPath)}
                strokeWidth={onPath || lit ? 2 : 1.25}
                className={cn(
                  'fill-none transition-opacity duration-150 motion-reduce:transition-none',
                  onPath ? 'stroke-danger' : lit ? 'stroke-fg' : 'stroke-border-strong',
                  active !== null && !lit && 'opacity-20',
                )}
              />
            );
          })}
        </svg>
        {columns.map((nodes, column) => (
          <ul key={map.columns[column]} aria-label={map.columns[column]} className="contents">
            <li
              aria-hidden="true"
              className="absolute top-0 text-xs font-medium uppercase tracking-wider text-fg-muted"
              style={{ left: layout.columnX[column] ?? 0, width: LAYOUT.nodeWidth }}
            >
              {map.columns[column]}
            </li>
            {nodes.map((node) => {
              const position = layout.positions.get(node.id);
              if (position === undefined) return null;
              const props = nodeProps(node);
              return (
                <li
                  key={node.id}
                  className="absolute"
                  style={{
                    left: position.x,
                    top: position.y + HEADER,
                    width: LAYOUT.nodeWidth,
                    height: LAYOUT.nodeHeight,
                  }}
                >
                  <button
                    {...props}
                    className={cn(
                      props.className,
                      'h-full w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                    )}
                  >
                    {body(node)}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </div>
  );
}

function Detail({ node }: { node: MapNode }): React.ReactElement {
  return (
    <DialogContent data-testid="map-detail" className="flex h-full flex-col">
      <DialogHeader>
        <DialogTitle>{node.label}</DialogTitle>
        <DialogDescription className="inline-flex items-center gap-2">
          <StatusDot status={STATUS_DOT[node.status]} />
          {`${node.detail} · ${STATUS_WORD[node.status]}`}
        </DialogDescription>
      </DialogHeader>
      {node.evidence.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing recorded for this node.</p>
      ) : (
        <dl className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {node.evidence.map((item, index) => (
            <div key={`${item.label}-${String(index)}`} className="py-2.5">
              <dt className="text-xs text-fg-muted">{item.label}</dt>
              <dd
                className={cn('m-0 break-words text-sm text-fg', item.mono && 'font-mono text-xs')}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {node.link === undefined ? null : (
        <Link
          to={node.link.to}
          className={cn(
            'mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-on-fill no-underline hover:opacity-90',
            FOCUS,
          )}
        >
          {node.link.label}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </DialogContent>
  );
}
