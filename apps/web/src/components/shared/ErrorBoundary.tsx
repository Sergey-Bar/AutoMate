import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, RefreshCw, Bug, WifiOff } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional panel label shown in the error card header */
  label?: string;
  /** Custom fallback — overrides the default error card */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

// ─── Error type detection ───────────────────────────────────────────────────

type ErrorVariant = 'network' | 'not-found' | 'generic';

function detectErrorVariant(error: Error): ErrorVariant {
  const msg = error.message.toLowerCase();
  // Network errors
  if (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    error.name === 'TypeError' && msg.includes('fetch')
  ) {
    return 'network';
  }
  // 404 resource errors
  if (msg.includes('not found') || msg.includes('404')) {
    return 'not-found';
  }
  return 'generic';
}

/**
 * Class-based error boundary.
 * Catches render errors in any descendant and shows a contained fallback
 * so the rest of the app stays alive.
 *
 * Automatically detects error type and renders the appropriate variant:
 * - Network errors → retry button
 * - 404 → "Resource not found"
 * - Generic → crash card with error message
 *
 * Usage:
 *   <ErrorBoundary label="Chat">
 *     <ChatPanel />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    // In production, you could send this to an error tracking service
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    const variant = detectErrorVariant(error);

    if (variant === 'network') {
      return <NetworkErrorCard onRetry={this.reset} />;
    }

    if (variant === 'not-found') {
      return (
        <NotFoundCard
          label={this.props.label}
          error={error}
          onReset={this.reset}
        />
      );
    }

    return (
      <DefaultErrorCard
        label={this.props.label}
        error={error}
        onReset={this.reset}
      />
    );
  }
}

// ─── Network error card ─────────────────────────────────────────────────────

function NetworkErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle p-8 text-center"
      style={{ minHeight: 160 }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full text-warning"
        style={{ background: 'oklch(0.78 0.17 68 / 12%)' }}
      >
        <WifiOff size={20} />
      </div>

      <div>
        <p className="text-sm font-semibold text-text-primary">
          Connection Lost
        </p>
        <p className="mt-1 max-w-sm text-xs text-text-tertiary">
          Unable to reach the server. Check your connection and try again.
        </p>
      </div>

      <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ─── Not Found card ─────────────────────────────────────────────────────────

function NotFoundCard({
  label,
  error,
  onReset,
}: {
  label?: string;
  error: Error;
  onReset: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle p-8 text-center"
      style={{ minHeight: 160 }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full text-warning"
        style={{ background: 'oklch(0.55 0.15 30 / 12%)' }}
      >
        <AlertTriangle size={20} />
      </div>

      <div>
        <p className="text-sm font-semibold text-text-primary">
          {label ? `${label} not found` : 'Resource not found'}
        </p>
        <p className="mt-1 max-w-sm text-xs text-text-tertiary">
          {error.message || 'The requested resource could not be found.'}
        </p>
      </div>

      <Button variant="secondary" size="sm" onClick={onReset}>
        Go Back
      </Button>
    </div>
  );
}

// ─── Default error card ─────────────────────────────────────────────────────

function DefaultErrorCard({
  label,
  error,
  onReset,
}: {
  label?: string;
  error: Error;
  onReset: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-xl border p-8 text-center"
      style={{
        background: 'oklch(0.15 0.02 0)',
        borderColor: 'var(--color-error)',
        minHeight: 160,
      }}
    >
      {/* Icon */}
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full text-error"
        style={{ background: 'oklch(0.35 0.18 25 / 20%)' }}
      >
        <Bug size={20} />
      </div>

      {/* Heading */}
      <div>
        <p className="text-sm font-semibold text-text-primary">
          {label ? `${label} crashed` : 'Something went wrong'}
        </p>
        <p className="mt-1 max-w-sm truncate text-xs text-text-tertiary">
          {error.message || 'An unexpected render error occurred.'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          icon={<RefreshCw size={12} />}
          onClick={onReset}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
