import { describe, expect, it } from 'vitest';
import { LAYOUT, layoutMap } from './map-layout.js';
import type { RepoMap } from './repo-map.js';

function map(columns: number[]): RepoMap {
  const nodes = columns.flatMap((count, column) =>
    Array.from({ length: count }, (_, row) => ({
      id: `c${String(column)}r${String(row)}`,
      label: 'n',
      detail: '',
      column,
      status: 'unknown' as const,
      kind: 'package' as const,
      evidence: [],
    })),
  );
  const edges = [
    { id: 'c0r0->c1r1', from: 'c0r0', to: 'c1r1' },
    { id: 'c0r0->c2r0', from: 'c0r0', to: 'c2r0' },
  ];
  return {
    view: 'packages',
    columns: columns.map((_, index) => `Column ${String(index)}`),
    nodes,
    edges,
    blockingPath: [],
    notice: null,
    pathNote: null,
  };
}

describe('layoutMap', () => {
  it('places each column at a fixed stride, left to right', () => {
    const layout = layoutMap(map([1, 2, 1]));
    expect(layout.positions.get('c0r0')?.x).toBe(0);
    expect(layout.positions.get('c1r0')?.x).toBe(LAYOUT.columnStride);
    expect(layout.positions.get('c2r0')?.x).toBe(LAYOUT.columnStride * 2);
    expect(layout.width).toBe(LAYOUT.columnStride * 2 + LAYOUT.nodeWidth);
  });

  it('never overlaps two nodes in a column', () => {
    const layout = layoutMap(map([3, 7, 2]));
    for (const column of [0, 1, 2]) {
      const ys = [...layout.positions.entries()]
        .filter(([id]) => id.startsWith(`c${String(column)}`))
        .map(([, position]) => position.y)
        .sort((a, b) => a - b);
      for (let index = 1; index < ys.length; index += 1) {
        expect((ys[index] ?? 0) - (ys[index - 1] ?? 0)).toBeGreaterThanOrEqual(
          LAYOUT.nodeHeight + LAYOUT.rowGap,
        );
      }
    }
  });

  it('places a parent level with its first child, so a tall column keeps its parents in view', () => {
    // c0r0 → c1r1 only. A parent centred on the tallest column would sit off screen
    // whenever the evidence column is long; level with its first child it reads as a tree.
    const layout = layoutMap(map([1, 5]));
    const child = layout.positions.get('c1r1')?.y ?? -1;
    expect(layout.positions.get('c0r0')?.y).toBe(child);
    expect(layout.height).toBe(5 * LAYOUT.nodeHeight + 4 * LAYOUT.rowGap);
  });

  it('starts a column with no children at the top', () => {
    const layout = layoutMap(map([1, 2, 1]));
    expect(layout.positions.get('c1r0')?.y).toBe(0);
  });

  it('draws each edge from the right edge of one node to the left edge of the next', () => {
    const layout = layoutMap(map([1, 2, 1]));
    const from = layout.positions.get('c0r0');
    const to = layout.positions.get('c1r1');
    const path = layout.paths.get('c0r0->c1r1') ?? '';
    const start = `M ${String((from?.x ?? 0) + LAYOUT.nodeWidth)} ${String((from?.y ?? 0) + LAYOUT.nodeHeight / 2)}`;
    expect(path.startsWith(start)).toBe(true);
    expect(path.endsWith(`${String(to?.x)} ${String((to?.y ?? 0) + LAYOUT.nodeHeight / 2)}`)).toBe(
      true,
    );
    expect(path).toContain(' C ');
  });

  it('is deterministic: the same map lays out the same way every time', () => {
    const once = layoutMap(map([2, 3, 1]));
    const twice = layoutMap(map([2, 3, 1]));
    expect([...twice.positions.entries()]).toEqual([...once.positions.entries()]);
    expect([...twice.paths.entries()]).toEqual([...once.paths.entries()]);
  });

  it('skips an edge whose end is not on the map rather than drawing it to the origin', () => {
    const broken = map([1, 1]);
    broken.edges.push({ id: 'c0r0->ghost', from: 'c0r0', to: 'ghost' });
    expect(layoutMap(broken).paths.has('c0r0->ghost')).toBe(false);
  });
});
