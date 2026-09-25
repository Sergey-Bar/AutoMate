import type { TestStatus } from './types';

// ─── Duration formatting ───────────────────────────────────────────────────
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** Format elapsed seconds as MM:SS (for live run timer) */
export function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** "3 minutes ago", "just now", etc. */
export function timeAgo(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const diff = Date.now() - new Date(dateString).getTime();
  if (diff < 10_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Status helpers ────────────────────────────────────────────────────────
export function statusColor(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'var(--color-pass)',
    failed:   'var(--color-fail)',
    timedOut: 'var(--color-fail)',
    flaky:    'var(--color-flaky)',
    running:  'var(--color-running)',
    skipped:  'var(--color-skip)',
    queued:   'var(--color-queued)',
  };
  return map[status] ?? 'var(--color-text-tertiary)';
}

export function statusBgColor(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'var(--color-pass-bg)',
    failed:   'var(--color-fail-bg)',
    timedOut: 'var(--color-fail-bg)',
    flaky:    'var(--color-flaky-bg)',
    running:  'var(--color-running-bg)',
    skipped:  'var(--color-skip-bg)',
    queued:   'var(--color-queued-bg)',
  };
  return map[status] ?? 'transparent';
}

// ─── Status class helpers (Tailwind CSS 4 @theme utilities) ────────────────
export function statusTextClass(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'text-pass',
    failed:   'text-fail',
    timedOut: 'text-fail',
    flaky:    'text-flaky',
    running:  'text-running',
    skipped:  'text-skip',
    queued:   'text-queued',
  };
  return map[status] ?? 'text-text-tertiary';
}

export function statusBgClass(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'bg-pass-bg',
    failed:   'bg-fail-bg',
    timedOut: 'bg-fail-bg',
    flaky:    'bg-flaky-bg',
    running:  'bg-running-bg',
    skipped:  'bg-skip-bg',
    queued:   'bg-queued-bg',
  };
  return map[status] ?? 'bg-transparent';
}

export function statusBorderClass(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'border-pass/25',
    failed:   'border-fail/25',
    timedOut: 'border-fail/25',
    flaky:    'border-flaky/25',
    running:  'border-running/25',
    skipped:  'border-skip/25',
    queued:   'border-queued/25',
  };
  return map[status] ?? 'border-transparent';
}

export function statusSolidBgClass(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'bg-pass',
    failed:   'bg-fail',
    timedOut: 'bg-fail',
    flaky:    'bg-flaky',
    running:  'bg-running',
    skipped:  'bg-skip',
    queued:   'bg-queued',
  };
  return map[status] ?? 'bg-text-tertiary';
}

export function statusLabel(status: TestStatus | string): string {
  const map: Record<string, string> = {
    passed:   'Passed',
    failed:   'Failed',
    timedOut: 'Timed out',
    flaky:    'Flaky',
    running:  'Running',
    skipped:  'Skipped',
    queued:   'Queued',
    interrupted: 'Aborted',
  };
  return map[status] ?? status;
}

// ─── Pass rate ─────────────────────────────────────────────────────────────
export function passRate(passed: number, total: number): string {
  if (total === 0) return '—';
  return `${((passed / total) * 100).toFixed(1)}%`;
}

// ─── File path ─────────────────────────────────────────────────────────────
/** Shorten a file path to just the last 2 segments */
export function shortPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

/** Extract just the filename */
export function fileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

// ─── SHA ───────────────────────────────────────────────────────────────────
export function shortSha(sha: string | null | undefined, len = 7): string {
  if (!sha) return '—';
  return sha.slice(0, len);
}

// ─── ANSI stripping ────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[mGKHF]/g;
export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

// ─── JSON helpers ─────────────────────────────────────────────────────────
export function tryParseJSON<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); }
  catch { return fallback; }
}

// ─── Greeting ─────────────────────────────────────────────────────────────
export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ─── Date formatting ─────────────────────────────────────────────────────
/** Format an ISO date string as e.g. "Mar 1, 2026, 02:30 PM" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
