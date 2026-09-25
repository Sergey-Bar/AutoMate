const SQL_PATTERNS = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM\s+\w|WHERE|JOIN|SQLITE|PRAGMA)\b/i;
const PATH_PATTERNS = /[A-Z]:\\|\/var\/|\/app\/|\/home\/|\/usr\/|\/tmp\/|\.sqlite|\.db\b/i;
const STACK_TRACE = /\n\s+at\s+/;

const ERROR_MAP: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /SQLITE_ERROR|SQLITE_CONSTRAINT|SQLITE_BUSY|SQLITE_LOCKED/i, message: 'A database error occurred. Please try again or contact support.' },
  { pattern: /Failed to fetch|NetworkError|ERR_NETWORK|ERR_CONNECTION/i, message: 'Unable to connect to the server. Check your network connection.' },
  { pattern: /AbortError|operation was aborted|timeout/i, message: 'The request timed out. Please try again.' },
  { pattern: /ENOENT|EACCES|EPERM|EISDIR/i, message: 'An unexpected error occurred.' },
  { pattern: /JSON\.parse|Unexpected token|SyntaxError/i, message: 'Received an invalid response from the server.' },
];

export function getUserFriendlyError(message: string): string {
  for (const { pattern, message: friendly } of ERROR_MAP) {
    if (pattern.test(message)) return friendly;
  }
  return sanitizeErrorMessage(message);
}

export function sanitizeErrorMessage(message: string): string {
  if (!message) return message;
  if (STACK_TRACE.test(message)) {
    return message.split('\n')[0] ?? message;
  }
  if (SQL_PATTERNS.test(message) || PATH_PATTERNS.test(message)) {
    return 'An unexpected error occurred.';
  }
  return message;
}
