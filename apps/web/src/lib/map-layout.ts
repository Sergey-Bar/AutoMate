import type { RepoMap } from './repo-map.js';

/**
 * Coordinates for a repo map: deterministic columns and cubic edges.
 *
 * No graph library. The map is a layered DAG whose layers are its columns, so a column
 * stride places every node horizontally; vertically each column is a stack in which a
 * parent sits level with its first child, and each edge is one cubic Bézier from
 * the right edge of its source to the left edge of its target. Same input, same picture.
 */
export const LAYOUT = {
  nodeWidth: 184,
  nodeHeight: 60,
  rowGap: 14,
  columnGap: 72,
  get columnStride(): number {
    return this.nodeWidth + this.columnGap;
  },
} as const;

export interface MapLayout {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number }>;
  paths: Map<string, string>;
  /** The x of each column, for its heading. */
  columnX: number[];
}

export function layoutMap(map: Pick<RepoMap, 'columns' | 'nodes' | 'edges'>): MapLayout {
  const rowStride = LAYOUT.nodeHeight + LAYOUT.rowGap;
  const byColumn = map.columns.map((_, column) =>
    map.nodes.filter((node) => node.column === column),
  );
  const columnOf = new Map(map.nodes.map((node) => [node.id, node.column]));

  // Right to left: a column is stacked from the top, and a node with children further right
  // moves down to level with its first child — never up past the node above it, so nothing
  // overlaps and the column keeps its order. Level with the first child rather than the
  // middle of them, so a repository with forty packages is still at the top of the screen.
  const positions = new Map<string, { x: number; y: number }>();
  for (let column = byColumn.length - 1; column >= 0; column -= 1) {
    let floor = 0;
    for (const node of byColumn[column] ?? []) {
      const children = map.edges
        .filter((edge) => edge.from === node.id && (columnOf.get(edge.to) ?? -1) > column)
        .map((edge) => positions.get(edge.to)?.y)
        .filter((y): y is number => y !== undefined);
      const middle = children.length === 0 ? floor : Math.min(...children);
      const y = Math.max(floor, middle);
      positions.set(node.id, { x: column * LAYOUT.columnStride, y });
      floor = y + rowStride;
    }
  }
  const height = Math.max(
    0,
    ...[...positions.values()].map((position) => position.y + LAYOUT.nodeHeight),
  );

  const paths = new Map<string, string>();
  for (const edge of map.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const x1 = from.x + LAYOUT.nodeWidth;
    const y1 = from.y + LAYOUT.nodeHeight / 2;
    const x2 = to.x;
    const y2 = to.y + LAYOUT.nodeHeight / 2;
    const bend = (x2 - x1) / 2;
    paths.set(
      edge.id,
      `M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`,
    );
  }

  const columns = map.columns.length;
  return {
    width: columns === 0 ? 0 : (columns - 1) * LAYOUT.columnStride + LAYOUT.nodeWidth,
    height,
    positions,
    paths,
    columnX: map.columns.map((_, column) => column * LAYOUT.columnStride),
  };
}
