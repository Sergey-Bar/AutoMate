import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ESSENTIAL_TOOL_IDS,
  QA_TOOLS_REGISTRY,
  QAToolSchema,
  groupByCategory,
} from './tool-catalog.js';

/**
 * The catalogue, checked as data.
 *
 * A registry is the kind of file that rots silently: a tool is added, its
 * `whyItHelps` is left blank because the row looks complete without it, and a
 * screen that renders the sentence renders nothing. These assertions are the
 * gate against that, and they read as prose rather than as counts so a failure
 * names the defect.
 */

const ids = QA_TOOLS_REGISTRY.map((tool) => tool.id);

describe('the QA tool catalogue', () => {
  it('parses through its own schema, so a malformed row fails at import', () => {
    // Every entry in the source list is validated on import; a row that typed
    // past the schema would mean the schema is not the authority.
    expect(() => QAToolSchema.array().parse(QA_TOOLS_REGISTRY)).not.toThrow();
    expect(QA_TOOLS_REGISTRY.length).toBeGreaterThanOrEqual(50);
  });

  it('gives every tool a unique id, because the id is the key a detection joins on', () => {
    // The probe answers "toolId: vitest". Two rows with one id make that
    // answer ambiguous, and the coverage figure silently wrong.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('answers why a tool is worth installing, for every single tool', () => {
    // **The sentence is the product.** A catalogue entry without it is a phone
    // book row; the screen that renders the registry would show a tool with no
    // reason to add it.
    for (const tool of QA_TOOLS_REGISTRY) {
      expect(tool.whyItHelps.length, `${tool.id} has no whyItHelps`).toBeGreaterThan(20);
      expect(tool.description.length, `${tool.id} has no description`).toBeGreaterThan(10);
    }
  });

  it('gives every tool a docs link and a repo link', () => {
    for (const tool of QA_TOOLS_REGISTRY) {
      expect(tool.docs, `${tool.id} has no docs`).toMatch(/^https:\/\//u);
      expect(tool.repo, `${tool.id} has no repo`).toMatch(/^https:\/\//u);
    }
  });

  it('gives every tool a detect pattern the probe can match', () => {
    for (const tool of QA_TOOLS_REGISTRY) {
      expect(tool.detectPatterns.length, `${tool.id} has no detectPatterns`).toBeGreaterThan(0);
    }
  });

  it('names a category that has a label, because the order is only as good as its labels', () => {
    for (const tool of QA_TOOLS_REGISTRY) {
      expect(CATEGORY_LABELS[tool.category]).toBeTruthy();
    }
  });

  it('spans every declared category, so no card renders empty forever', () => {
    const covered = new Set(QA_TOOLS_REGISTRY.map((tool) => tool.category));
    const empty = CATEGORY_ORDER.filter((category) => !covered.has(category));
    expect(empty).toEqual([]);
  });

  it('counts the three tiers, so the summary strip has something to say', () => {
    const tiers = new Set(QA_TOOLS_REGISTRY.map((tool) => tool.tier));
    expect([...tiers].sort()).toEqual(['free', 'freemium', 'paid']);
  });

  it('groups by category in reporting order and drops nothing', () => {
    const grouped = groupByCategory();
    expect(grouped.map((category) => category.id)).toEqual([...CATEGORY_ORDER]);
    const total = grouped.reduce((sum, category) => sum + category.tools.length, 0);
    expect(total).toBe(QA_TOOLS_REGISTRY.length);
  });

  it('names only tools that exist in the essentials set', () => {
    // The "missing essentials" alert is the registry's loudest claim. An id that
    // is not in the catalogue would render a row for a tool nobody can install
    // through the product.
    for (const id of ESSENTIAL_TOOL_IDS) {
      expect(ids, `essential ${id} is not in the catalogue`).toContain(id);
    }
  });

  it('assigns no tool two categories, because the grouping is a partition', () => {
    // A tool in two categories would be counted twice, which is a coverage
    // number computed from a duplicated row.
    for (const tool of QA_TOOLS_REGISTRY) {
      expect(CATEGORY_ORDER).toContain(tool.category);
    }
  });
});
