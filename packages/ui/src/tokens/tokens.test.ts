import { describe, it, expect } from 'vitest';
import { tokens, tailwindPreset } from './index.js';

// Simple relative luminance calculation
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function extractHex(val: string): string {
  if (val.startsWith('#')) return val;
  const match = val.match(/#([0-9a-fA-F]{3,6})/);
  if (match) return match[0];
  throw new Error(`Could not extract hex from ${val}`);
}

function hexToRgb(hex: string): [number, number, number] {
  const c = extractHex(hex).slice(1);
  const num = parseInt(c, 16);
  if (c.length === 3) {
    const r = (num >> 8) & 0xf;
    const g = (num >> 4) & 0xf;
    const b = num & 0xf;
    return [(r << 4) | r, (g << 4) | g, (b << 4) | b];
  }
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return relativeLuminance(r, g, b);
}

describe('Design Tokens', () => {
  it('should export tokens and tailwindPreset', () => {
    expect(tokens).toBeDefined();
    expect(tailwindPreset).toBeDefined();
    expect(tailwindPreset.theme).toBeDefined();
    expect(tailwindPreset.theme.extend).toBeDefined();
  });

  it('should have semantic color tokens', () => {
    const { colors } = tokens;
    expect(colors.surface).toBeDefined();
    expect(colors['surface-muted']).toBeDefined();
    expect(colors.border).toBeDefined();
    expect(colors.fg).toBeDefined();
    expect(colors['fg-muted']).toBeDefined();
    expect(colors.accent).toBeDefined();
    expect(colors.success).toBeDefined();
    expect(colors.warning).toBeDefined();
    expect(colors.danger).toBeDefined();
    expect(colors.info).toBeDefined();
  });

  it('should have 11-step color ramps per hue', () => {
    const { colors } = tokens;
    const ramps = Object.values(colors).filter(v => typeof v === 'object' && v !== null);
    expect(ramps.length).toBeGreaterThan(0);
    for (const ramp of ramps) {
      expect(Object.keys(ramp as Record<string, string>).length).toBeGreaterThanOrEqual(11);
    }
  });

  it('should have typography tokens', () => {
    const { typography } = tokens;
    expect(Object.keys(typography.fontFamily).length).toBe(2);
    expect(Object.keys(typography.fontSize).length).toBe(6);
    expect(Object.keys(typography.fontWeight).length).toBe(4);
  });

  it('should have spacing tokens', () => {
    expect(tokens.spacing).toBeDefined();
  });

  it('should have radii tokens', () => {
    expect(tokens.radii).toBeDefined();
  });

  it('should have shadows tokens', () => {
    expect(tokens.shadows).toBeDefined();
  });

  it('should have motion tokens', () => {
    expect(tokens.motion).toBeDefined();
  });

  it('should have z-index tokens', () => {
    expect(tokens.zIndex).toBeDefined();
  });

  it('contrast ratios should be >= 4.5:1 for fg vs surface', () => {
    const { colors } = tokens;
    const l1 = getLuminance(colors.fg as string);
    const l2 = getLuminance(colors.surface as string);
    const ratio = contrastRatio(l1, l2);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
