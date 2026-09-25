export type AnalyticsPreset = 'all' | 'developer' | 'qa-lead' | 'engineering-manager' | 'pm' | 'executive';

export interface PresetConfig {
  label: string;       // Display name
  description: string; // Short description
  widgets: string[];   // Ordered list of widget IDs to show
}

// Widget IDs matching the existing chart components:
// 'pass-rate', 'duration', 'heatmap', 'flaky', 'slowest', 'gantt', 'category'
// Stakeholder-specific widget IDs (T14):
// 'quarantine-queue', 'stability-trends', 'exec-roi-metrics'

export const ANALYTICS_PRESETS: Record<AnalyticsPreset, PresetConfig> = {
  all: {
    label: 'All Metrics',
    description: 'Complete analytics dashboard',
    widgets: ['pass-rate', 'duration', 'heatmap', 'flaky', 'slowest', 'gantt', 'category'],
  },
  developer: {
    label: 'Developer',
    description: 'Failure patterns, error traces, and speed insights',
    widgets: ['heatmap', 'pass-rate', 'flaky', 'slowest'],
  },
  'qa-lead': {
    label: 'QA Lead',
    description: 'Flaky tests, quarantine queue, and stability trends',
    widgets: ['flaky', 'quarantine-queue', 'stability-trends', 'heatmap'],
  },
  'engineering-manager': {
    label: 'Engineering Manager',
    description: 'Pass-rate trends, duration, and category breakdown',
    widgets: ['pass-rate', 'duration', 'category', 'heatmap'],
  },
  pm: {
    label: 'Product Manager',
    description: 'Release readiness, quality trends, and category summary',
    widgets: ['pass-rate', 'category', 'duration'],
  },
  executive: {
    label: 'Executive',
    description: 'High-level quality trends and ROI metrics',
    widgets: ['pass-rate', 'duration', 'exec-roi-metrics'],
  },
};
