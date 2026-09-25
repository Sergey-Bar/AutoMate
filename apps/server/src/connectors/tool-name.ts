import { TOOL_NAME_PATTERN } from '@automate/shared';

/**
 * Validates that a tool name follows the dot-notation convention:
 * `connector-name.tool_name`
 *
 * - Connector part: lowercase letters, digits, hyphens (starts with letter)
 * - Tool part: lowercase letters, digits, underscores (starts with letter)
 * - Separated by a single dot
 */
export function isValidToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name);
}
