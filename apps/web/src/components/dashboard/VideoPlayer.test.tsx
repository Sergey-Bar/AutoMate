/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VideoPlayer } from './VideoPlayer.js';

describe('VideoPlayer', () => {
  it('renders placeholder when no src provided', () => {
    render(<VideoPlayer />);
    expect(screen.getByTestId('video-player-placeholder')).toBeInTheDocument();
    expect(screen.getByText('No video available')).toBeInTheDocument();
  });

  it('renders video element when src is provided', () => {
    render(<VideoPlayer src="http://example.com/video.mp4" />);
    expect(screen.getByTestId('video-player')).toBeInTheDocument();
    const video = screen.getByTestId('video-element') as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(video.src).toBe('http://example.com/video.mp4');
  });

  it('sets poster attribute when provided', () => {
    render(<VideoPlayer src="http://example.com/video.mp4" poster="http://example.com/poster.png" />);
    const video = screen.getByTestId('video-element') as HTMLVideoElement;
    expect(video.poster).toBe('http://example.com/poster.png');
  });

  it('video element has controls attribute', () => {
    render(<VideoPlayer src="http://example.com/video.mp4" />);
    const video = screen.getByTestId('video-element') as HTMLVideoElement;
    expect(video).toHaveAttribute('controls');
  });
});
