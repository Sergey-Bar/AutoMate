import {
  SCORE_CATEGORIES,
  type QaCapability,
  type ReleaseReadinessCard,
  type RepoScan,
  type ScoreCategory,
  type ScoreCell,
} from '@automate/shared-contracts';

/**
 * The repository as an explorable map: two views of one set of facts.
 *
 * - **Packages** — Repository → packages → the reports and tools in each. Answers "where
 *   in my code is quality weak": a package takes the colour of its worst report.
 * - **Flow** — Code → layers → tools → reports → verdict. Answers "why is the release
 *   blocked": the blocking path is every edge from a failing node to the verdict.
 *
 * Built only from what the client already reads — the repository scan, the score cells and
 * the readiness card — so the map needs no endpoint of its own. Pure, so every rule below
 * is a unit test; `map-layout.ts` turns the result into coordinates.
 *
 * ## Status is a verdict or nothing
 *
 * `good`, `warn` and `bad` come from evidence. `unknown` means nothing measured it, and is
 * drawn hollow — never as a pass. `muted` is a node that is not a verdict at all (a tool, the
 * code) or was declared `n/a`.
 */

export type MapView = 'packages' | 'flow';
export const MAP_VIEWS: readonly MapView[] = ['flow', 'packages'];

export type NodeStatus = 'good' | 'warn' | 'bad' | 'unknown' | 'muted';
export type NodeKind =
  'repo' | 'package' | 'tools' | 'report' | 'code' | 'layer' | 'tool' | 'verdict';

export interface Evidence {
  label: string;
  value: string;
  mono?: boolean;
}

/** Where a node's drawer sends the reader next. */
export interface NodeLink {
  label: string;
  to:
    | '/dashboard'
    | '/dashboard/runs'
    | '/dashboard/runner'
    | '/dashboard/insights'
    | '/dashboard/health'
    | '/dashboard/toolbox';
}

export interface MapNode {
  id: string;
  label: string;
  detail: string;
  column: number;
  status: NodeStatus;
  kind: NodeKind;
  evidence: Evidence[];
  link?: NodeLink;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
}

export interface RepoMap {
  view: MapView;
  columns: string[];
  nodes: MapNode[];
  edges: MapEdge[];
  /** Edge ids on a path that explains the worst news on this view. */
  blockingPath: string[];
  /** One sentence the map needs said above it, or `null`. */
  notice: string | null;
  /** Why the blocking path is empty when the verdict is not Go, or `null`. */
  pathNote: string | null;
}

/** The parts of each read the map uses, so a test builds only what it means. */
export interface MapInput {
  projectName: string;
  scan: Pick<RepoScan, 'sourceFiles' | 'testFiles' | 'tools' | 'reports' | 'detected'>;
  score: { cells: readonly ScoreCell[] } | null;
  readiness: ReleaseReadinessCard | null;
}

const RANK: Record<NodeStatus, number> = { bad: 0, warn: 1, good: 2, unknown: 3, muted: 4 };

/**
 * The worst verdict in a set; `unknown` when none of them is a verdict.
 *
 * An unmeasured member never lets the set pass: good beside unknown is `warn`, because
 * "everything we measured passed" is not "it passed" when something was not measured.
 */
function worst(statuses: readonly NodeStatus[]): NodeStatus {
  const verdicts = statuses.filter(
    (status) => status === 'bad' || status === 'warn' || status === 'good',
  );
  if (verdicts.length === 0) return 'unknown';
  const ranked = [...verdicts].sort((left, right) => RANK[left] - RANK[right])[0] ?? 'unknown';
  return ranked === 'good' && statuses.includes('unknown') ? 'warn' : ranked;
}

/** " · 2 unmeasured", or nothing. */
function unmeasured(statuses: readonly NodeStatus[]): string {
  const count = statuses.filter((status) => status === 'unknown').length;
  return count === 0 ? '' : ` · ${String(count)} unmeasured`;
}

function reportStatus(status: RepoScan['reports'][number]['status']): NodeStatus {
  return status === 'info' ? 'unknown' : status;
}

const WORKSPACE_DIR = /^((?:apps|packages|tools|services|libs)\/[^/]+)\//u;

/**
 * The package a repository path belongs to: the longest tool directory it sits under, then
 * a workspace-shaped prefix (`apps/x`, `packages/y`), then the root.
 */
export function packageOf(path: string, known: readonly string[]): string {
  const owner = [...known]
    .filter((dir) => dir !== '.' && path.startsWith(`${dir}/`))
    .sort((left, right) => right.length - left.length)[0];
  if (owner !== undefined) return owner;
  return WORKSPACE_DIR.exec(path)?.[1] ?? '.';
}

const LAYER_OF: Partial<Record<QaCapability, ScoreCategory>> = {
  unit: 'unit',
  integration: 'integration',
  contract: 'integration',
  api: 'integration',
  e2e: 'e2e',
  visual: 'e2e',
  accessibility: 'e2e',
  mobile: 'e2e',
  performance: 'performance',
  sast: 'security',
  secrets: 'security',
  dependencies: 'security',
  dast: 'security',
};

/** The score layer a capability tests, or `null` for one that is not a test layer. */
export function layerOf(capability: QaCapability): ScoreCategory | null {
  return LAYER_OF[capability] ?? null;
}

type ReportKind = RepoScan['reports'][number]['kind'];

const REPORT_OF: Record<QaCapability, ReportKind> = {
  unit: 'tests',
  integration: 'tests',
  e2e: 'tests',
  contract: 'tests',
  api: 'tests',
  visual: 'tests',
  accessibility: 'tests',
  mobile: 'tests',
  coverage: 'coverage',
  'static-analysis': 'lint',
  types: 'lint',
  formatting: 'lint',
  sast: 'security',
  secrets: 'security',
  dependencies: 'security',
  dast: 'security',
  performance: 'performance',
  mutation: 'quality',
  ci: 'quality',
  'test-management': 'quality',
};

const LAYER_LABEL: Record<ScoreCategory, string> = {
  unit: 'Unit',
  integration: 'Integration',
  e2e: 'E2E',
  performance: 'Performance',
  security: 'Security',
};

const REPORT_LABEL: Record<ReportKind, string> = {
  coverage: 'Coverage',
  tests: 'Tests',
  lint: 'Lint',
  security: 'Security',
  performance: 'Performance',
  quality: 'Quality',
};

const VERDICT: Record<ReleaseReadinessCard['verdict'], { label: string; status: NodeStatus }> = {
  go: { label: 'Go', status: 'good' },
  caution: { label: 'Caution', status: 'warn' },
  'no-go': { label: 'No-go', status: 'bad' },
};

function edge(from: string, to: string): MapEdge {
  return { id: `${from}->${to}`, from, to };
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

function reportNode(report: RepoScan['reports'][number], column: number): MapNode {
  return {
    id: `report:${report.path}`,
    label: report.path.split('/').pop() ?? report.path,
    detail: report.kind,
    column,
    status: reportStatus(report.status),
    kind: 'report',
    evidence: [
      { label: 'Report', value: report.headline },
      { label: 'Path', value: report.path, mono: true },
      { label: 'Kind', value: `${report.kind} · ${report.format}` },
      ...Object.entries(report.metrics).map(([key, value]) => ({
        label: key,
        value: String(value),
        mono: true,
      })),
    ],
    link: { label: 'Open capabilities', to: '/dashboard/health' },
  };
}

function packagesView(input: MapInput): Omit<RepoMap, 'blockingPath' | 'notice' | 'pathNote'> {
  const { scan } = input;
  const toolDirs = [...new Set(scan.tools.map((tool) => tool.workingDirectory))];
  const owner = new Map<string, string>();
  for (const report of scan.reports) owner.set(report.path, packageOf(report.path, toolDirs));
  const dirs = [...new Set([...toolDirs, ...owner.values()])].sort((left, right) =>
    left === '.' ? -1 : right === '.' ? 1 : left.localeCompare(right),
  );

  const nodes: MapNode[] = [
    {
      id: 'repo',
      label: input.projectName,
      detail: `${String(scan.sourceFiles)} source · ${String(scan.testFiles)} test files`,
      column: 0,
      status: 'muted',
      kind: 'repo',
      evidence: [
        { label: 'Source files', value: String(scan.sourceFiles) },
        { label: 'Test files', value: String(scan.testFiles) },
        { label: 'Packages', value: String(dirs.length) },
      ],
    },
  ];
  const edges: MapEdge[] = [];
  for (const dir of dirs) {
    const reports = scan.reports
      .filter((report) => owner.get(report.path) === dir)
      .sort((left, right) => left.path.localeCompare(right.path));
    const tools = scan.tools.filter((tool) => tool.workingDirectory === dir);
    const id = `pkg:${dir}`;
    const statuses = reports.map((report) => reportStatus(report.status));
    nodes.push({
      id,
      label: dir === '.' ? 'Root' : dir,
      detail: `${plural(tools.length, 'tool')} · ${plural(reports.length, 'report')}${unmeasured(statuses)}`,
      column: 1,
      status: worst(statuses),
      kind: 'package',
      evidence: [
        { label: 'Directory', value: dir, mono: true },
        ...reports.map((report) => ({ label: report.kind, value: report.headline })),
      ],
    });
    edges.push(edge('repo', id));
    for (const report of reports) {
      nodes.push(reportNode(report, 2));
      edges.push(edge(id, `report:${report.path}`));
    }
    if (tools.length > 0) {
      const toolsId = `tools:${dir}`;
      nodes.push({
        id: toolsId,
        label: plural(tools.length, 'tool'),
        detail: [...new Set(tools.map((tool) => tool.kind))].join(' · '),
        column: 2,
        status: 'muted',
        kind: 'tools',
        evidence: tools.map((tool) => ({ label: tool.name, value: tool.label, mono: true })),
        link: { label: 'Launch one', to: '/dashboard/runner' },
      });
      edges.push(edge(id, toolsId));
    }
  }
  return { view: 'packages', columns: ['Repository', 'Packages', 'Evidence'], nodes, edges };
}

interface LayerCounts {
  failed: number;
  flaky: number;
  hollow: number;
  present: number;
}

function countLayer(cells: readonly ScoreCell[]): LayerCounts {
  const sum = (pick: (cell: ScoreCell) => readonly string[]) =>
    cells.reduce((total, cell) => total + pick(cell).length, 0);
  return {
    failed: sum((cell) => cell.inputs.failedFingerprints),
    flaky: sum((cell) => cell.inputs.flakyFingerprints),
    hollow: sum((cell) => cell.inputs.hollowFingerprints),
    present: cells.filter((cell) => cell.presence > 0).length,
  };
}

/** Failed is bad, flaky or hollow warns, a layer nobody built is unknown, n/a is muted. */
function layerStatus(
  read: boolean,
  cells: number,
  counted: number,
  counts: LayerCounts,
): NodeStatus {
  if (!read || cells === 0) return 'unknown';
  if (counted === 0) return 'muted';
  if (counts.failed > 0) return 'bad';
  if (counts.flaky + counts.hollow > 0) return 'warn';
  return counts.present === 0 ? 'unknown' : 'good';
}

function layerDetail(status: NodeStatus, read: boolean, counts: LayerCounts): string {
  if (status === 'muted') return 'n/a';
  if (status === 'unknown') return read ? 'no suite found' : 'score unread';
  const parts = [
    counts.failed > 0 ? `${String(counts.failed)} failing` : null,
    counts.flaky > 0 ? `${String(counts.flaky)} flaky` : null,
    counts.hollow > 0 ? `${String(counts.hollow)} hollow` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : `${plural(counts.present, 'surface')} passing`;
}

function cellEvidence(cell: ScoreCell): Evidence[] {
  const coverage =
    cell.inputs.surfaceCoverage === null
      ? ' · coverage unmeasured'
      : ` · coverage ${(cell.inputs.surfaceCoverage * 100).toFixed(0)}%`;
  return [
    {
      label: cell.key,
      value: cell.excluded
        ? 'declared n/a'
        : `score ${cell.score.toFixed(2)} · ${String(cell.inputs.executedTests)} tests${coverage}`,
      mono: true,
    },
    ...cell.inputs.failedFingerprints.map((value) => ({ label: 'failing', value, mono: true })),
    ...cell.inputs.flakyFingerprints.map((value) => ({ label: 'flaky', value, mono: true })),
    ...cell.inputs.hollowFingerprints.map((value) => ({ label: 'hollow', value, mono: true })),
  ];
}

function layerNode(category: ScoreCategory, score: MapInput['score']): MapNode {
  const cells = (score?.cells ?? []).filter((cell) => cell.category === category);
  const counted = cells.filter((cell) => !cell.excluded);
  const counts = countLayer(counted);
  const read = score !== null;
  const status = layerStatus(read, cells.length, counted.length, counts);
  return {
    id: `layer:${category}`,
    label: LAYER_LABEL[category],
    detail: layerDetail(status, read, counts),
    column: 1,
    status,
    kind: 'layer',
    evidence: cells.flatMap(cellEvidence),
    link: { label: 'Open insights', to: '/dashboard/insights' },
  };
}

type DetectedTool = MapInput['scan']['detected'][number];

/**
 * Tools that test no layer — linters, type checkers, duplication — share one node, so the
 * code has one line to them rather than one per tool crossing the layers column.
 */
function staticChecksNode(detected: readonly DetectedTool[]): MapNode | null {
  const unlayered = detected.filter((tool) => layerOf(tool.capability) === null);
  if (unlayered.length === 0) return null;
  return {
    id: 'layer:static',
    label: 'Static checks',
    detail: plural(unlayered.length, 'tool'),
    column: 1,
    status: 'muted',
    kind: 'layer',
    evidence: unlayered.map((tool) => ({ label: tool.name, value: tool.capability })),
    link: { label: 'Open the toolbox', to: '/dashboard/toolbox' },
  };
}

/** One node per detected tool, under its layer, feeding the report kind it produces. */
function wireTools(
  detected: readonly DetectedTool[],
  kinds: readonly ReportKind[],
  nodes: MapNode[],
  edges: MapEdge[],
): { fed: Set<ReportKind>; reaching: Set<string> } {
  const fed = new Set<ReportKind>();
  // Layers with at least one tool whose report is on disk. Every other layer gets its own
  // edge to the verdict, or a red layer whose junit file was never written is a dead end.
  const reaching = new Set<string>();
  // In layer order, static checks last, so a tool sits beside the layer it belongs to and
  // the layout's "parent level with its first child" keeps the layers column compact.
  const rank = (tool: DetectedTool) => {
    const layer = layerOf(tool.capability);
    return layer === null ? SCORE_CATEGORIES.length : SCORE_CATEGORIES.indexOf(layer);
  };
  const ordered = [...detected].sort((left, right) => rank(left) - rank(right));
  for (const tool of ordered) {
    const id = `tool:${tool.id}`;
    nodes.push({
      id,
      label: tool.name,
      detail: tool.capability,
      column: 2,
      status: 'muted',
      kind: 'tool',
      evidence: [
        { label: 'Capability', value: tool.capability },
        { label: 'Found in', value: tool.evidence, mono: true },
      ],
      link: { label: 'Open the toolbox', to: '/dashboard/toolbox' },
    });
    const layer = layerOf(tool.capability);
    const parent = layer === null ? 'layer:static' : `layer:${layer}`;
    edges.push(edge(parent, id));
    const kind = REPORT_OF[tool.capability];
    if (kinds.includes(kind)) {
      edges.push(edge(id, `reports:${kind}`));
      fed.add(kind);
      reaching.add(parent);
    }
  }
  return { fed, reaching };
}

function flowView(input: MapInput): Omit<RepoMap, 'blockingPath' | 'notice' | 'pathNote'> {
  const { scan, score, readiness } = input;
  const nodes: MapNode[] = [
    {
      id: 'code',
      label: 'Code',
      detail: `${String(scan.sourceFiles)} source · ${String(scan.testFiles)} tests`,
      column: 0,
      status: 'muted',
      kind: 'code',
      evidence: [
        { label: 'Source files', value: String(scan.sourceFiles) },
        { label: 'Test files', value: String(scan.testFiles) },
      ],
    },
  ];
  const edges: MapEdge[] = [];
  const layers = SCORE_CATEGORIES.map((category) => layerNode(category, score));
  for (const layer of layers) {
    nodes.push(layer);
    edges.push(edge('code', layer.id));
  }

  const kinds = [...new Set(scan.reports.map((report) => report.kind))].sort();
  const statics = staticChecksNode(scan.detected);
  if (statics !== null) {
    nodes.push(statics);
    edges.push(edge('code', statics.id));
  }
  const { fed, reaching } = wireTools(scan.detected, kinds, nodes, edges);

  for (const kind of kinds) {
    const reports = scan.reports.filter((report) => report.kind === kind);
    const id = `reports:${kind}`;
    const statuses = reports.map((report) => reportStatus(report.status));
    nodes.push({
      id,
      label: REPORT_LABEL[kind],
      detail: `${plural(reports.length, 'report')}${unmeasured(statuses)}`,
      column: 3,
      status: worst(statuses),
      kind: 'report',
      evidence: reports.map((report) => ({ label: report.path, value: report.headline })),
      link: { label: 'Open capabilities', to: '/dashboard/health' },
    });
    if (!fed.has(kind)) edges.push(edge('code', id));
    edges.push(edge(id, 'verdict'));
  }
  for (const layer of layers) {
    if (!reaching.has(layer.id)) edges.push(edge(layer.id, 'verdict'));
  }

  const verdict = readiness === null ? null : VERDICT[readiness.verdict];
  nodes.push({
    id: 'verdict',
    label: verdict?.label ?? 'Unknown',
    detail: readiness === null ? 'readiness unread' : 'release readiness',
    column: 4,
    status: verdict?.status ?? 'unknown',
    kind: 'verdict',
    evidence: (readiness?.reasons ?? []).map((reason) => ({
      label: reason.level,
      value: `${reason.message} — ${reason.evidence}`,
    })),
    link: { label: 'Open the overview', to: '/dashboard' },
  });

  return {
    view: 'flow',
    columns: ['Code', 'Layers', 'Tools', 'Reports', 'Verdict'],
    nodes,
    edges,
  };
}

/** Nodes reachable from `start` along `edges`, in the direction `next` gives. */
function reach(
  start: Iterable<string>,
  edges: readonly MapEdge[],
  next: (edge: MapEdge) => [string, string],
): Set<string> {
  const seen = new Set(start);
  const queue = [...seen];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const candidate of edges) {
      const [from, to] = next(candidate);
      if (from === current && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

/** Every edge on some path from a source to a target. */
function pathBetween(
  edges: readonly MapEdge[],
  sources: Iterable<string>,
  targets: Iterable<string>,
): string[] {
  const forward = reach(sources, edges, (candidate) => [candidate.from, candidate.to]);
  const backward = reach(targets, edges, (candidate) => [candidate.to, candidate.from]);
  return edges
    .filter((candidate) => forward.has(candidate.from) && backward.has(candidate.to))
    .map((candidate) => candidate.id);
}

export function buildRepoMap(input: MapInput, view: MapView): RepoMap {
  const base = view === 'packages' ? packagesView(input) : flowView(input);
  const failing = base.nodes.filter((node) => node.status === 'bad');
  const blockingPath =
    view === 'packages'
      ? pathBetween(
          base.edges,
          ['repo'],
          failing.filter((node) => node.kind === 'report').map((node) => node.id),
        )
      : pathBetween(
          base.edges,
          failing.filter((node) => node.id !== 'verdict').map((node) => node.id),
          ['verdict'],
        );
  const scoredLayers = base.nodes.filter(
    (node) => node.kind === 'layer' && node.id !== 'layer:static' && node.status !== 'unknown',
  );
  const notice =
    view === 'flow' && scoredLayers.length === 0
      ? 'No test layer has been scored yet. Run a suite through Launch and its results fill the layers in; until then each one reads “not measured”, never as a pass.'
      : null;
  const verdict = base.nodes.find((node) => node.id === 'verdict');
  // A No-go set only by activity, quarantine or gate reasons has no failing node to start a
  // path from. Say so, rather than a pressed toggle that draws nothing.
  const pathNote =
    verdict !== undefined &&
    (verdict.status === 'bad' || verdict.status === 'warn') &&
    blockingPath.length === 0
      ? `Nothing on this view explains the ${verdict.label}. Open the verdict for the readiness reasons behind it.`
      : null;
  return { ...base, blockingPath, notice, pathNote };
}

/** A node's whole lineage: everything upstream and downstream of it, and the edges between. */
export function traceOf(
  map: Pick<RepoMap, 'edges'>,
  nodeId: string | null,
): { nodes: Set<string>; edges: Set<string> } {
  if (nodeId === null) return { nodes: new Set(), edges: new Set() };
  const down = reach([nodeId], map.edges, (candidate) => [candidate.from, candidate.to]);
  const up = reach([nodeId], map.edges, (candidate) => [candidate.to, candidate.from]);
  const nodes = new Set([...down, ...up]);
  const edges = new Set(
    map.edges
      .filter(
        (candidate) =>
          (down.has(candidate.from) && down.has(candidate.to)) ||
          (up.has(candidate.from) && up.has(candidate.to)),
      )
      .map((candidate) => candidate.id),
  );
  return { nodes, edges };
}

export interface MapSearch {
  view: MapView;
  node: string | undefined;
  path: boolean;
}

/** The map's state as URL search params: only what differs from the default is present. */
export type MapSearchParams = {
  view?: 'packages';
  node?: string;
  path?: true;
};

/** The URL form of a state, so the default view is a plain `/dashboard/map`. */
export function compactMapSearch(state: MapSearch): MapSearchParams {
  return {
    ...(state.view === 'packages' ? { view: 'packages' as const } : {}),
    ...(state.node === undefined ? {} : { node: state.node }),
    ...(state.path ? { path: true as const } : {}),
  };
}

/** The map's URL state, read defensively: a value it does not understand is ignored. */
export function parseMapSearch(search: Record<string, unknown>): MapSearch {
  const view = search['view'];
  const node = search['node'];
  const path = search['path'];
  return {
    view: view === 'packages' || view === 'flow' ? view : 'flow',
    node: typeof node === 'string' && node.length > 0 ? node : undefined,
    path: path === true || path === '1' || path === 1,
  };
}
