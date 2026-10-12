import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ESSENTIAL_TOOL_IDS,
  QA_TOOLS_REGISTRY,
  type QATool,
} from '@automate/projects/tool-catalog';
import { analyzeStack, groupByCategory } from './analysis.js';

/**
 * The stack analysis, tested directly.
 *
 * The component that renders it is a prototype screen, but the arithmetic is
 * not prototype code: the coverage percentage a reader sees is computed here,
 * and the rule "a missing detection row means undetected" is what makes that
 * number mean anything. Both are asserted without rendering a card.
 *
 * **The registry comes from the package now**, so these tests use a small
 * synthetic set for the arithmetic and the real catalogue for the joins that
 * are about the catalogue's own shape.
 */

/** A tool with the fields the analysis reads, and plausible others. */
function tool(id: string, category: QATool['category'], tier: QATool['tier'] = 'free'): QATool {
  return {
    id,
    name: id,
    description: `${id} description`,
    whyItHelps: `${id} makes the suite trustworthy`,
    category,
    tier,
    homepage: `https://example.com/${id}`,
    repo: `https://github.com/example/${id}`,
    docs: `https://example.com/${id}/docs`,
    installCommand: `install ${id}`,
    detectPatterns: [`${id}.config.ts`],
    dependencyNames: [],
    tags: [],
    maintenanceStatus: 'active',
    learningCurve: 'low',
  };
}

const tools = [
  tool('vitest', 'test-framework'),
  tool('mystery', 'test-runner', 'paid'),
  tool('k6', 'load-testing', 'freemium'),
];

describe('analyzeStack', () => {
  it('joins detections by tool id, and a missing row means undetected', () => {
    // The probe answers for the tools it checked. A tool it never mentioned is
    // a tool it did not find — inventing `detected: false` with fabricated
    // evidence would be worse than saying so, because the coverage figure is
    // computed from this join.
    const { statuses } = analyzeStack(tools, [
      { toolId: 'vitest', detected: true, evidence: 'vitest.config.ts' },
    ]);
    expect(statuses).toHaveLength(3);
    expect(statuses[0]).toEqual({
      tool: tools[0],
      detected: true,
      evidence: 'vitest.config.ts',
    });
    expect(statuses[1]).toEqual({ tool: tools[1], detected: false, evidence: null });
    expect(statuses[2]).toEqual({ tool: tools[2], detected: false, evidence: null });
  });

  it('computes coverage as a percentage of the registry, not of the detections', () => {
    // One detected of three is a third, not a half — the denominator is the
    // registry, because that is the number the card says "coverage" about.
    const { coverage } = analyzeStack(tools, [
      { toolId: 'vitest', detected: true, evidence: 'vitest.config.ts' },
    ]);
    expect(coverage).toBe(33);
  });

  it('reports zero coverage for an empty registry rather than NaN', () => {
    const { coverage, statuses } = analyzeStack([], []);
    expect(coverage).toBe(0);
    expect(statuses).toEqual([]);
  });

  it('keeps the evidence the detection carried, so the claim is checkable', () => {
    const { statuses } = analyzeStack(tools, [
      { toolId: 'k6', detected: true, evidence: 'package.json' },
      { toolId: 'vitest', detected: false, evidence: null },
    ]);
    expect(statuses[2]?.evidence).toBe('package.json');
    // A detection that says "not detected" still carries no evidence — a
    // negative with a file path is a contradiction, not a finding.
    expect(statuses[0]?.detected).toBe(false);
    expect(statuses[0]?.evidence).toBeNull();
  });
});

describe('groupByCategory', () => {
  it('follows the declared order and drops the categories with no tools', () => {
    const grouped = groupByCategory(tools);
    expect(grouped.map((category) => category.id)).toEqual([
      'test-framework',
      'test-runner',
      'load-testing',
    ]);
    // The names come from the catalogue's own labels, so a category card shows
    // "Test Frameworks" rather than the raw id.
    expect(grouped[0]?.name).toBe('Test Frameworks');
    expect(grouped[0]?.description).toBeTruthy();
    expect(grouped[0]?.tools.map((entry) => entry.id)).toEqual(['vitest']);
  });

  it('names every declared category, because the order is only as good as its labels', () => {
    // `CATEGORY_ORDER` is a hand-written list. If it gains a category with no
    // label, the UI renders the raw id — so the two lists are asserted against
    // each other, against the catalogue's own labels, rather than trusted.
    for (const id of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[id], `${id} has no label`).toBeTruthy();
    }
  });

  it('returns nothing for an empty registry', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('ESSENTIAL_TOOL_IDS', () => {
  it('names tools that exist in the registry', () => {
    // The essential set is the "missing" alert's whole content. An id that is
    // not in the registry would render a row for a tool nobody can install
    // through the product.
    const known = new Set(QA_TOOLS_REGISTRY.map((entry) => entry.id));
    for (const id of ESSENTIAL_TOOL_IDS) {
      expect(known.has(id)).toBe(true);
    }
  });
});
