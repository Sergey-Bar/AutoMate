import Bottleneck from 'bottleneck';

export interface RateLimiterOptions {
  maxConcurrent: number;
  minTime: number;
  reservoir?: number;
  reservoirRefreshInterval?: number;
  reservoirRefreshAmount?: number;
}

export function createConnectorLimiter(opts: RateLimiterOptions): Bottleneck {
  return new Bottleneck(opts);
}
