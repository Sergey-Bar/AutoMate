import { SafeErrorMessage } from './SafeErrorMessage';

interface ErrorAlertProps {
  /** Error object or plain message string */
  error: Error | string | unknown;
  /** Optional label prefix, e.g. "Failed to load runs" */
  message?: string;
  /** Show a retry / reload action button */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Inline destructive alert for query/fetch errors.
 * Renders as a compact banner inside its container — not a modal.
 *
 * Usage:
 *   if (isError) return <ErrorAlert error={error} onRetry={refetch} />
 */
export function ErrorAlert({
  error,
  message,
  onRetry,
  retryLabel = 'Retry',
}: ErrorAlertProps) {
  const displayError = message ?? error;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border px-4 py-3"
      style={{
        background: 'oklch(0.2 0.04 25)',
        borderColor: 'oklch(0.5 0.2 25)',
      }}
    >
      {/* Icon column */}
      <span
        className="mt-0.5 shrink-0 text-base leading-none text-fail"
        aria-hidden
      >
        ⚠
      </span>

      {/* Text column */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-fail">
          Error
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          <SafeErrorMessage error={displayError} />
        </p>
      </div>

      {/* Retry button */}
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ background: 'oklch(0.5 0.2 25)', color: '#fff' }}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
