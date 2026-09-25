import type { z } from 'zod/v4';

/**
 * Formats Zod validation issues into a single human-readable string.
 *
 * Each issue becomes `path: message` (or `body: message` for top-level errors),
 * joined by semicolons.
 */
export function formatValidationError(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
