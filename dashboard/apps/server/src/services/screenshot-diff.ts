/**
 * screenshot-diff.ts — server-side screenshot diffing service
 *
 * Exports two plain functions (no classes, no factory, no strategy pattern):
 *   diffWithPixelmatch()  — pixel-level diff using pixelmatch + pngjs
 *   diffWithLooksSame()   — perceptual diff using looks-same
 *   diffWithPipeline()    — 3-stage pipeline: pixel → perceptual → AI vision
 */
import * as path from 'path';
import * as fs from 'fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import looksSame from 'looks-same';
import type { AiProviderConfig } from '@automate/dashboard-shared';
import { analyzeVisionDiff, type VisionDiffResult } from './vision-diff.js';
import { supportsVision } from './ai-provider-registry.js';

export interface DiffResult {
  diffCount: number;
  totalPixels: number;
  diffPercentage: number;
  diffImagePath: string;
  width: number;
  height: number;
  error?: string;
}

/**
 * Diffs two PNG files using pixelmatch.
 * Returns a DiffResult with pixel counts and the path to the generated diff image.
 * On size mismatch, returns an error result (does not throw).
 */
export async function diffWithPixelmatch(
  expectedPath: string,
  actualPath: string,
): Promise<DiffResult> {
  const expectedBuffer = fs.readFileSync(expectedPath);
  const actualBuffer = fs.readFileSync(actualPath);

  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);

  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      diffCount: 0,
      totalPixels: 0,
      diffPercentage: 0,
      diffImagePath: '',
      width: expected.width,
      height: expected.height,
      error: `Image dimensions do not match: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
    };
  }

  const { width, height } = expected;
  const diff = new PNG({ width, height });
  const totalPixels = width * height;

  const diffCount = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );

  // Write diff image alongside the actual file
  const dir = path.dirname(actualPath);
  const baseName = path.basename(actualPath).replace(/-actual\.png$/, '').replace(/\.actual\.png$/, '');
  const diffImagePath = path.join(dir, `${baseName}-diff.png`);
  fs.writeFileSync(diffImagePath, PNG.sync.write(diff));

  return {
    diffCount,
    totalPixels,
    diffPercentage: totalPixels === 0 ? 0 : (diffCount / totalPixels) * 100,
    diffImagePath,
    width,
    height,
  };
}

/**
 * Diffs two PNG files using looks-same for perceptual (anti-aliasing-aware) comparison.
 * Returns the same DiffResult shape as diffWithPixelmatch() for interchangeability.
 * On error (e.g. size mismatch), returns an error result (does not throw).
 */
export async function diffWithLooksSame(
  expectedPath: string,
  actualPath: string,
): Promise<DiffResult> {
  const dir = path.dirname(actualPath);
  const baseName = path.basename(actualPath).replace(/-actual\.png$/, '').replace(/\.actual\.png$/, '');
  const diffImagePath = path.join(dir, `${baseName}-diff.png`);

  try {
    const result = await looksSame(expectedPath, actualPath, {
      strict: false,
      tolerance: 2.5,
      antialiasingTolerance: 4,
      createDiffImage: true,
    });

    if (result.equal) {
      // Identical — write an empty diff image so the path is always valid
      await looksSame.createDiff({
        reference: expectedPath,
        current: actualPath,
        diff: diffImagePath,
        highlightColor: '#ff00ff',
        strict: false,
        tolerance: 2.5,
        antialiasingTolerance: 4,
      });

      const total = result.totalPixels ?? 0;
      const expectedPng = PNG.sync.read(fs.readFileSync(expectedPath));
      return {
        diffCount: 0,
        totalPixels: total,
        diffPercentage: 0,
        diffImagePath,
        width: expectedPng.width,
        height: expectedPng.height,
      };
    }

    // Not equal — save diff image (guard in case diffImage is absent)
    if (result.diffImage) {
      await result.diffImage.save(diffImagePath);
    }

    const diffCount = result.differentPixels ?? 0;
    const totalPixels = result.totalPixels ?? 0;
    const diffWidth = result.diffImage?.width ?? PNG.sync.read(fs.readFileSync(expectedPath)).width;
    const diffHeight = result.diffImage?.height ?? PNG.sync.read(fs.readFileSync(expectedPath)).height;

    return {
      diffCount,
      totalPixels,
      diffPercentage: totalPixels === 0 ? 0 : (diffCount / totalPixels) * 100,
      diffImagePath,
      width: diffWidth,
      height: diffHeight,
    };
  } catch (err) {
    return {
      diffCount: 0,
      totalPixels: 0,
      diffPercentage: 0,
      diffImagePath: '',
      width: 0,
      height: 0,
      error: (err as Error).message,
    };
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export interface PipelineResult extends DiffResult {
  diffStage: 'pixel' | 'perceptual' | 'ai';
  aiAnalysis?: VisionDiffResult;
}

/**
 * Runs a 3-stage screenshot diff pipeline with graceful degradation:
 *   Stage 1 (pixel):      pixelmatch — fast pixel-level comparison
 *   Stage 2 (perceptual): looks-same — anti-aliasing-aware comparison
 *   Stage 3 (AI vision):  AI provider — semantic significance analysis
 *
 * Short-circuits early when possible (identical images stop at stage 1).
 * AI stage only runs when aiConfig is provided with visionDiffEnabled=true
 * and the configured model supports vision input.
 */
export async function diffWithPipeline(
  expectedPath: string,
  actualPath: string,
  aiConfig?: AiProviderConfig,
): Promise<PipelineResult> {
  // Stage 1: pixel diff
  const pixelResult = await diffWithPixelmatch(expectedPath, actualPath);

  if (pixelResult.diffPercentage < 0.1) {
    return { ...pixelResult, diffStage: 'pixel' };
  }

  // Stage 2: perceptual diff
  const perceptualResult = await diffWithLooksSame(expectedPath, actualPath);

  if (perceptualResult.diffPercentage === 0) {
    return { ...perceptualResult, diffStage: 'perceptual' };
  }

  // Stage 3: AI vision — only when configured and supported
  if (
    aiConfig !== undefined &&
    aiConfig.visionDiffEnabled === true &&
    perceptualResult.diffPercentage > (aiConfig.visionDiffThreshold ?? 0.5) &&
    supportsVision(aiConfig)
  ) {
    try {
      const aiAnalysis = await analyzeVisionDiff(expectedPath, actualPath, aiConfig);
      return { ...perceptualResult, diffStage: 'ai', aiAnalysis };
    } catch {
      // Graceful degradation: AI failed, return stage 2 result
      return { ...perceptualResult, diffStage: 'perceptual' };
    }
  }

  return { ...perceptualResult, diffStage: 'perceptual' };
}
