import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, Badge, Button, Input } from '@automate/ui';

export type RecorderStatus = 'idle' | 'recording' | 'paused';

export interface RecorderBridgeProps {
  status: RecorderStatus;
  onStart: (url: string) => void;
  onStop: () => void;
  onPause: () => void;
}

const STATUS_LABELS: Record<RecorderStatus, string> = {
  idle: 'Idle',
  recording: 'Recording',
  paused: 'Paused',
};

const STATUS_VARIANTS: Record<RecorderStatus, 'default' | 'success' | 'warning'> = {
  idle: 'default',
  recording: 'success',
  paused: 'warning',
};

export function RecorderBridge({ status, onStart, onStop, onPause }: RecorderBridgeProps) {
  const [url, setUrl] = useState('');

  const handleStart = () => {
    onStart(url);
  };

  return (
    <Card data-testid="recorder-bridge">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recorder</CardTitle>
          <Badge variant={STATUS_VARIANTS[status]} data-testid="recorder-status">
            {STATUS_LABELS[status]}
          </Badge>
        </div>
      </CardHeader>
      <div className="p-4 flex flex-col gap-4">
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            data-testid="url-input"
            disabled={status === 'recording'}
            className="flex-1"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            onClick={handleStart}
            disabled={status === 'recording'}
            data-testid="start-button"
          >
            Start
          </Button>
          <Button
            variant="outline"
            onClick={onPause}
            disabled={status !== 'recording'}
            data-testid="pause-button"
          >
            Pause
          </Button>
          <Button
            variant="destructive"
            onClick={onStop}
            disabled={status === 'idle'}
            data-testid="stop-button"
          >
            Stop
          </Button>
        </div>
      </div>
    </Card>
  );
}
