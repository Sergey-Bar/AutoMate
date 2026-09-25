import {
  retry,
  circuitBreaker,
  timeout,
  wrap,
  handleType,
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
} from 'cockatiel';
import { ConnectorError } from './errors.js';

export interface ResiliencePolicyOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  consecutiveFailures?: number;
  halfOpenAfterMs?: number;
}

export function createResiliencePolicy(opts?: ResiliencePolicyOptions) {
  const {
    maxAttempts = 3,
    timeoutMs = 10_000,
    consecutiveFailures = 5,
    halfOpenAfterMs = 30_000,
  } = opts ?? {};

  const retryPolicy = retry(
    handleType(ConnectorError, (e) => e.kind === 'transient'),
    { maxAttempts, backoff: new ExponentialBackoff() }
  );

  const cbPolicy = circuitBreaker(
    handleType(ConnectorError, (e) => e.kind === 'transient'),
    { halfOpenAfter: halfOpenAfterMs, breaker: new ConsecutiveBreaker(consecutiveFailures) }
  );

  const timeoutPolicy = timeout(timeoutMs, TimeoutStrategy.Aggressive);

  return wrap(retryPolicy, cbPolicy, timeoutPolicy);
}
