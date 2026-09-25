import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';
import { safePath } from '../utils/safe-path.js';

const WINDOW = 250;
const MAX_LINES = 500;

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

export interface ReadTestSourceOptions {
  file: string;
  line?: number;
  baseDir?: string;
}

export interface TestSourceResult {
  content: string;
  language: string;
  file: string;
  line?: number;
  startLine: number;
}

export interface TestSourceError {
  type: 'invalid-path' | 'not-found' | 'read-error';
  message: string;
}

/**
 * Reads test source file with optional windowing around a target line.
 * 
 * Security: Uses safePath to prevent path traversal attacks.
 * Performance: Truncates large files to 500 lines around target line.
 * 
 * @param options - File path, optional line number, and base directory
 * @returns Result with content and metadata, or error descriptor
 */
export function readTestSource(
  options: ReadTestSourceOptions,
): { success: true; data: TestSourceResult } | { success: false; error: TestSourceError } {
  const { file, line, baseDir = process.cwd() } = options;

  // Security: reject path traversal
  let fullPath: string;
  try {
    fullPath = safePath(baseDir, file);
  } catch {
    return {
      success: false,
      error: { type: 'invalid-path', message: 'Invalid file path' },
    };
  }

  if (!existsSync(fullPath)) {
    return {
      success: false,
      error: { type: 'not-found', message: 'File not found' },
    };
  }

  try {
    const raw = readFileSync(fullPath, 'utf-8');
    const allLines = raw.split('\n');

    // Truncate to MAX_LINES around the target line
    let content = raw;
    let startLine = 1;
    if (line !== undefined && allLines.length > MAX_LINES) {
      const from = Math.max(0, line - WINDOW);
      const to = Math.min(allLines.length, line + WINDOW);
      content = allLines.slice(from, to).join('\n');
      startLine = from + 1;
    }

    // Determine language from extension
    const ext = extname(file).toLowerCase();
    const language = LANGUAGE_MAP[ext] ?? 'plaintext';

    return {
      success: true,
      data: { content, language, file, line, startLine },
    };
  } catch {
    return {
      success: false,
      error: { type: 'read-error', message: 'Failed to read file' },
    };
  }
}
