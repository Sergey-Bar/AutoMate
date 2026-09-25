/**
 * showToast — Standardized toast wrapper using Sonner.
 *
 * Centralizes toast durations and avoids spreading raw `toast.*()` calls.
 */
import { toast } from 'sonner';

const DURATION_SUCCESS = 3_000;
const DURATION_ERROR = 5_000;
const DURATION_INFO = 3_000;

export function showToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'success',
) {
  const duration =
    type === 'error' ? DURATION_ERROR
    : type === 'info' ? DURATION_INFO
    : DURATION_SUCCESS;

  toast[type](message, { duration });
}
