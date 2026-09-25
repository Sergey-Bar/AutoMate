import { getUserFriendlyError } from '../../lib/errorMessages';

interface SafeErrorMessageProps {
  error: unknown;
  fallback?: string;
  className?: string;
}

export function SafeErrorMessage({ error, fallback = 'An unexpected error occurred.', className }: SafeErrorMessageProps) {
  const message = error instanceof Error
    ? getUserFriendlyError(error.message)
    : typeof error === 'string'
      ? getUserFriendlyError(error)
      : fallback;

  return <span className={className}>{message}</span>;
}
