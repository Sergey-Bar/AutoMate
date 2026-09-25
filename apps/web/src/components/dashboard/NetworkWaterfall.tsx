import React from 'react';
import { Badge } from '@automate/ui';

export interface NetworkRequest {
  url: string;
  method: string;
  startMs: number;
  durationMs: number;
  status: number | string;
}

interface NetworkWaterfallProps {
  requests: NetworkRequest[];
}

function httpStatusVariant(status: number | string): 'success' | 'danger' | 'warning' | 'default' | 'secondary' {
  const code = typeof status === 'string' ? parseInt(status, 10) : status;
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400 && code < 500) return 'warning';
  if (code >= 500) return 'danger';
  if (code === 0 || isNaN(code)) return 'secondary';
  return 'default';
}

function httpStatusColor(status: number | string): string {
  const code = typeof status === 'string' ? parseInt(status, 10) : status;
  if (code >= 200 && code < 300) return '#22c55e';
  if (code >= 400 && code < 500) return '#f59e0b';
  if (code >= 500) return '#ef4444';
  return '#6b7280';
}

function truncateUrl(url: string, maxLen = 40): string {
  if (url.length <= maxLen) return url;
  return '…' + url.slice(url.length - (maxLen - 1));
}

export function NetworkWaterfall({ requests }: NetworkWaterfallProps) {
  if (requests.length === 0) {
    return (
      <div data-testid="network-waterfall-empty" className="text-text-secondary text-sm py-4 text-center">
        No network requests recorded.
      </div>
    );
  }

  const totalMs = Math.max(...requests.map((r) => r.startMs + r.durationMs));

  return (
    <div data-testid="network-waterfall" className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-text-secondary font-medium mb-1">
        <div className="w-12 shrink-0">Method</div>
        <div className="w-44 shrink-0">URL</div>
        <div className="flex-1">Timing</div>
        <div className="w-16 shrink-0 text-right">Status</div>
        <div className="w-20 shrink-0 text-right">Duration</div>
      </div>
      {requests.map((req, idx) => {
        const leftPct = totalMs > 0 ? (req.startMs / totalMs) * 100 : 0;
        const widthPct = totalMs > 0 ? Math.max((req.durationMs / totalMs) * 100, 0.5) : 0.5;

        return (
          <div key={idx} data-testid={`waterfall-row-${idx}`} className="flex items-center gap-3">
            <div className="w-12 shrink-0 text-xs font-mono font-semibold" data-testid={`waterfall-method-${idx}`}>
              {req.method}
            </div>
            <div className="w-44 shrink-0 truncate text-xs font-mono" title={req.url} data-testid={`waterfall-url-${idx}`}>
              {truncateUrl(req.url)}
            </div>
            <div className="flex-1 relative h-5 bg-surface-secondary rounded overflow-hidden">
              <div
                data-testid={`waterfall-bar-${idx}`}
                style={{
                  position: 'absolute',
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: '100%',
                  backgroundColor: httpStatusColor(req.status),
                  borderRadius: '2px',
                }}
                title={`${req.method} ${req.url} — ${req.durationMs}ms`}
              />
            </div>
            <div className="w-16 shrink-0 text-right">
              <Badge variant={httpStatusVariant(req.status)} data-testid={`waterfall-status-${idx}`}>
                {req.status}
              </Badge>
            </div>
            <div className="w-20 shrink-0 text-xs text-text-secondary text-right" data-testid={`waterfall-duration-${idx}`}>
              {req.durationMs}ms
            </div>
          </div>
        );
      })}
    </div>
  );
}
