/**
 * Duplicate-run detection and report reconciliation (spike S2). Throwaway prototype code.
 *
 * The policy, all proposals, and the reason for each:
 *
 * - **Byte-identical files are one artifact.** The digest is the identity, so counting a
 *   copy twice is unrepresentable rather than merely avoided.
 * - **Different formats of one execution are grouped, never merged.** Grouping needs
 *   evidence (a shared run key, the same commit, observation times close together, and tests
 *   in common) and the group carries its confidence and the limits of that evidence. A group
 *   is a statement that two reports probably describe one execution, and says how sure.
 * - **Reports from different commits are incomparable.** They are kept, listed, and not
 *   added to each other.
 * - **A contradiction is a finding.** When two reports of one execution disagree about a
 *   test, both outcomes are shown and `chosen` is null. The format ranking decides which
 *   report is shown first; it never decides which outcome is true.
 * - **Shards are added together, and missing shards make the run partial.**
 * - **Retries are attempts inside one result.** Nothing here merges across results, so a
 *   retry can never be mistaken for a duplicate.
 */
import { countsOf } from './model.mjs';

/** Observation times further apart than this are not one execution. A proposal, in ms. */
export const SAME_EXECUTION_WINDOW_MS = 5 * 60 * 1000;

/** Share of the smaller report's tests that must also appear in the other. A proposal. */
export const MIN_OVERLAP = 0.5;

/** Lower rank is the more authoritative source of the same execution. */
const FORMAT_RANK = { 'playwright-json': 1, 'junit-xml': 2 };

const COMPLETENESS_ORDER = ['complete', 'partial', 'unknown', 'rejected'];

/**
 * @typedef {{ id: string, sha256: string, result: any,
 *   context: Record<string, string | undefined> }} Item
 */

/**
 * @param {any} result
 * @returns {Set<string>}
 */
function testKeys(result) {
  return new Set(result.tests.map((/** @type {any} */ t) => `${t.file ?? ''}::${t.name}`));
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} the share of the smaller set that also appears in the other
 */
function overlap(a, b) {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const key of a) if (b.has(key)) shared += 1;
  return shared / smaller;
}

/**
 * @param {string | undefined} shard `index/total`
 * @returns {{ index: number, total: number } | null}
 */
function parseShard(shard) {
  const match = /^(\d+)\/(\d+)$/.exec(shard ?? '');
  return match === null ? null : { index: Number(match[1]), total: Number(match[2]) };
}

/**
 * How two distinct artifacts relate.
 *
 * @param {Item} a
 * @param {Item} b
 * @returns {{ relation: 'shards' | 'same-execution' | 'incomparable' | 'none',
 *   confidence?: string, limits: string[], evidence: string[], reason?: string }}
 */
function relate(a, b) {
  const none = { relation: /** @type {const} */ ('none'), limits: [], evidence: [] };
  const commitA = a.context.commit;
  const commitB = b.context.commit;
  const sharedKeys = overlap(testKeys(a.result), testKeys(b.result));

  if (commitA !== undefined && commitB !== undefined && commitA !== commitB) {
    return sharedKeys > 0
      ? { relation: 'incomparable', reason: 'different-commit', limits: [], evidence: [] }
      : none;
  }

  const shardA = parseShard(a.context.shard);
  const shardB = parseShard(b.context.shard);
  const sameRunKey = a.context.runKey !== undefined && a.context.runKey === b.context.runKey;
  if (
    sameRunKey &&
    shardA !== null &&
    shardB !== null &&
    shardA.total === shardB.total &&
    shardA.index !== shardB.index
  ) {
    return {
      relation: 'shards',
      confidence: 'high',
      limits: [],
      evidence: [
        `run key ${a.context.runKey ?? ''}`,
        `shards ${a.context.shard ?? ''} and ${b.context.shard ?? ''}`,
      ],
    };
  }

  if (a.result.format === b.result.format || sharedKeys < MIN_OVERLAP) return none;

  /** @type {string[]} */
  const limits = [];
  /** @type {string[]} */
  const evidence = [`${Math.round(sharedKeys * 100)}% of the smaller report's tests are in both`];
  const timeA = a.context.observedAt === undefined ? NaN : Date.parse(a.context.observedAt);
  const timeB = b.context.observedAt === undefined ? NaN : Date.parse(b.context.observedAt);
  if (Number.isNaN(timeA) || Number.isNaN(timeB)) limits.push('time-unknown');
  else if (Math.abs(timeA - timeB) > SAME_EXECUTION_WINDOW_MS) return none;
  else evidence.push('observed within the window');
  if (commitA === undefined || commitB === undefined) limits.push('commit-unknown');
  else evidence.push(`commit ${commitA}`);

  let confidence = 'medium';
  if (sameRunKey) confidence = 'high';
  else if (limits.length > 0) confidence = 'low';
  if (sameRunKey) evidence.push(`run key ${a.context.runKey ?? ''}`);
  return { relation: 'same-execution', confidence, limits, evidence };
}

/**
 * @param {Item[]} members
 * @returns {Item}
 */
function primaryOf(members) {
  const rank = (/** @type {Item} */ item) =>
    FORMAT_RANK[/** @type {keyof typeof FORMAT_RANK} */ (item.result.format)] ?? 3;
  return (
    [...members].sort((x, y) => rank(x) - rank(y))[0] ?? members[0] ?? /** @type {Item} */ ({})
  );
}

/**
 * @param {Item[]} items
 */
export function reconcile(items) {
  const unreadable = items
    .filter((item) => item.result.kind === 'rejected')
    .map((item) => ({ id: item.id, reason: item.result.rejection }));
  const runs = items.filter((item) => item.result.kind === 'run');

  /** @type {Map<string, Item[]>} */
  const byDigest = new Map();
  for (const item of runs) byDigest.set(item.sha256, [...(byDigest.get(item.sha256) ?? []), item]);
  const duplicates = [...byDigest.values()]
    .filter((same) => same.length > 1)
    .map((same) => ({ ids: same.map((item) => item.id) }));
  const distinct = [...byDigest.values()].map((same) => /** @type {Item} */ (same[0]));

  // Union-find over the distinct artifacts, joined by evidence.
  const parent = distinct.map((_, index) => index);
  const find = (/** @type {number} */ x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  /** @type {Array<{ i: number, j: number, rel: ReturnType<typeof relate> }>} */
  const edges = [];
  /** @type {Array<{ a: string, b: string, reason: string }>} */
  const incomparable = [];
  for (let i = 0; i < distinct.length; i += 1) {
    for (let j = i + 1; j < distinct.length; j += 1) {
      const a = /** @type {Item} */ (distinct[i]);
      const b = /** @type {Item} */ (distinct[j]);
      const rel = relate(a, b);
      if (rel.relation === 'incomparable')
        incomparable.push({ a: a.id, b: b.id, reason: rel.reason ?? '' });
      if (rel.relation === 'shards' || rel.relation === 'same-execution') {
        edges.push({ i, j, rel });
        parent[find(i)] = find(j);
      }
    }
  }

  /** @type {Map<number, number[]>} */
  const components = new Map();
  distinct.forEach((_, index) => {
    const root = find(index);
    components.set(root, [...(components.get(root) ?? []), index]);
  });

  const groups = [...components.values()].map((indexes) => {
    const members = indexes.map((index) => /** @type {Item} */ (distinct[index]));
    const own = edges.filter((edge) => indexes.includes(edge.i));
    const kinds = new Set(own.map((edge) => edge.rel.relation));
    const kind = own.length === 0 ? 'single' : kinds.size === 1 ? [...kinds][0] : 'mixed';
    const limits = [...new Set(own.flatMap((edge) => edge.rel.limits))];
    const order = ['high', 'medium', 'low'];
    const confidence =
      own.length === 0
        ? null
        : order[Math.max(...own.map((edge) => order.indexOf(edge.rel.confidence ?? 'low')))];
    const primary = primaryOf(members);

    // Shards: complete only when every expected shard is present.
    const shards = members
      .map((member) => parseShard(member.context.shard))
      .filter((shard) => shard !== null);
    const expected = Math.max(0, ...shards.map((shard) => shard?.total ?? 0));
    const present = new Set(shards.map((shard) => shard?.index)).size;
    const missingShards = expected > 0 && present < expected;
    if (missingShards) limits.push(`shards-missing:${String(present)}/${String(expected)}`);

    const weakest = members
      .map((member) => COMPLETENESS_ORDER.indexOf(member.result.completeness))
      .reduce((x, y) => Math.max(x, y), 0);
    const completeness = missingShards && weakest === 0 ? 'partial' : COMPLETENESS_ORDER[weakest];

    return {
      kind,
      confidence,
      members: members.map((member) => member.id),
      primary: kind === 'shards' ? null : primary.id,
      evidence: own.flatMap((edge) => edge.rel.evidence),
      limits,
      completeness,
      status: 'agreed',
      counts:
        kind === 'shards' || kind === 'single'
          ? sumCounts(members.map((member) => countsOf(member.result)))
          : countsOf(primary.result),
    };
  });

  // Disagreements between members that describe the same execution.
  /** @type {Array<{ testKey: string, sources: any[], chosen: null }>} */
  const disagreements = [];
  for (const group of groups) {
    if (group.kind !== 'same-execution' && group.kind !== 'mixed') continue;
    const members = group.members.map(
      (id) => /** @type {Item} */ (distinct.find((item) => item.id === id)),
    );
    /** @type {Map<string, any[]>} */
    const byKey = new Map();
    for (const member of members) {
      for (const test of member.result.tests) {
        const key = `${test.file ?? ''}::${test.name}`;
        byKey.set(key, [
          ...(byKey.get(key) ?? []),
          { id: member.id, format: member.result.format, outcome: test.outcome },
        ]);
      }
    }
    for (const [testKey, sources] of byKey) {
      const outcomes = new Set(sources.map((source) => source.outcome));
      if (sources.length > 1 && outcomes.size > 1) {
        disagreements.push({ testKey, sources, chosen: null });
        group.status = 'contested';
      }
    }
  }

  return {
    duplicates,
    groups,
    disagreements,
    incomparable,
    unreadable,
    aggregate: sumCounts(groups.map((group) => group.counts)),
  };
}

/**
 * @param {Array<Record<string, number>>} all
 * @returns {Record<string, number>}
 */
function sumCounts(all) {
  /** @type {Record<string, number>} */
  const total = {};
  for (const counts of all) {
    for (const [key, value] of Object.entries(counts)) total[key] = (total[key] ?? 0) + value;
  }
  return total;
}
