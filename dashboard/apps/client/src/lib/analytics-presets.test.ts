import { describe, it, expect } from 'vitest';
import { ANALYTICS_PRESETS } from './analytics-presets';

// All valid widget IDs: core widgets (in 'all' preset) + stakeholder-specific widgets (T14)
const KNOWN_WIDGET_IDS = [
  // Core
  'pass-rate', 'duration', 'heatmap', 'flaky', 'slowest', 'gantt', 'category',
  // T14 stakeholder-specific
  'quarantine-queue', 'stability-trends', 'exec-roi-metrics',
];

describe('Analytics Presets', () => {
  const allWidgets = ANALYTICS_PRESETS.all.widgets;

  it('should have valid widget IDs in all presets', () => {
    Object.values(ANALYTICS_PRESETS).forEach(preset => {
      preset.widgets.forEach(widgetId => {
        expect(KNOWN_WIDGET_IDS).toContain(widgetId);
      });
    });
  });

  it("should ensure the 'all' preset contains all core widgets", () => {
    const coreWidgetIds = ['pass-rate', 'duration', 'heatmap', 'flaky', 'slowest', 'gantt', 'category'];
    expect(allWidgets.sort()).toEqual(coreWidgetIds.sort());
  });

  it('should ensure role-specific presets only use known widget IDs', () => {
    const { all: _all, ...rolePresets } = ANALYTICS_PRESETS;
    Object.values(rolePresets).forEach(preset => {
      preset.widgets.forEach(widgetId => {
        expect(KNOWN_WIDGET_IDS).toContain(widgetId);
      });
      // Each role preset uses fewer widgets than the full set
      expect(preset.widgets.length).toBeLessThan(KNOWN_WIDGET_IDS.length);
    });
  });

  it('should have all 6 stakeholder presets defined', () => {
    const presetKeys = Object.keys(ANALYTICS_PRESETS);
    expect(presetKeys).toContain('all');
    expect(presetKeys).toContain('developer');
    expect(presetKeys).toContain('qa-lead');
    expect(presetKeys).toContain('engineering-manager');
    expect(presetKeys).toContain('pm');
    expect(presetKeys).toContain('executive');
  });

  it('qa-lead preset includes quarantine-queue and stability-trends', () => {
    expect(ANALYTICS_PRESETS['qa-lead'].widgets).toContain('quarantine-queue');
    expect(ANALYTICS_PRESETS['qa-lead'].widgets).toContain('stability-trends');
  });

  it('executive preset includes exec-roi-metrics', () => {
    expect(ANALYTICS_PRESETS['executive'].widgets).toContain('exec-roi-metrics');
  });

  it('qa-lead preset does NOT include exec-roi-metrics', () => {
    expect(ANALYTICS_PRESETS['qa-lead'].widgets).not.toContain('exec-roi-metrics');
  });

  it('each preset has a non-empty label and description', () => {
    Object.values(ANALYTICS_PRESETS).forEach(preset => {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    });
  });
});
