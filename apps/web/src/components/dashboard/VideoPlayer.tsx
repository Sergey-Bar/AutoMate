import React from 'react';
import { Card } from '@automate/ui';

export interface VideoPlayerProps {
  src?: string;
  poster?: string;
}

export function VideoPlayer({ src, poster }: VideoPlayerProps) {
  if (!src) {
    return (
      <Card className="p-6" data-testid="video-player-placeholder">
        <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 mb-2 opacity-40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
            />
          </svg>
          <span className="text-sm">No video available</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid="video-player">
      <video
        data-testid="video-element"
        src={src}
        poster={poster}
        controls
        className="w-full rounded"
        style={{ maxHeight: '480px' }}
      >
        Your browser does not support the video element.
      </video>
    </Card>
  );
}
