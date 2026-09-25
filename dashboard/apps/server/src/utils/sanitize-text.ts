/**
 * sanitize-text.ts — Escape user-supplied text for safe embedding in
 * Markdown tables (GitHub) and Slack mrkdwn blocks.
 */

/**
 * Escape characters that break Markdown table cells or render as formatting.
 *
 * Handles: pipe (cell boundary), newline (row boundary), backtick, asterisk,
 * underscore, square brackets (links).
 */
export function escapeMarkdown(str: string): string {
  return str
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * Escape characters that Slack interprets as mrkdwn formatting or special links.
 *
 * Per Slack docs the only required entity escapes are `&`, `<`, `>`.
 * We also neutralise formatting characters (`*`, `_`, `~`, `` ` ``)
 * by inserting a zero-width space after them so Slack's parser does not
 * treat them as formatting delimiters.
 */
export function escapeSlackMrkdwn(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_~`])/g, '$1\u200B');  // zero-width space breaks formatting
}
