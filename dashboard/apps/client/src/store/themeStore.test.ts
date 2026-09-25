/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock document and window before importing themeStore
const mockClassList = {
  add: vi.fn(),
  remove: vi.fn(),
};

const mockStyle: { colorScheme: string } = {
  colorScheme: '',
};

vi.stubGlobal('document', {
  documentElement: {
    classList: mockClassList,
    style: mockStyle,
  },
});

const mockMatchMedia = vi.fn().mockReturnValue({ matches: false });

vi.stubGlobal('window', {
  matchMedia: mockMatchMedia,
});

import { useThemeStore, applyTheme } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' });
    mockClassList.add.mockClear();
    mockClassList.remove.mockClear();
    mockStyle.colorScheme = '';
    mockMatchMedia.mockReset();
    mockMatchMedia.mockReturnValue({ matches: false });
  });

  describe('initial state', () => {
    it('defaults to dark theme', () => {
      expect(useThemeStore.getState().theme).toBe('dark');
    });
  });

  describe('setTheme', () => {
    it('sets theme to light', () => {
      useThemeStore.getState().setTheme('light');
      expect(useThemeStore.getState().theme).toBe('light');
    });

    it('sets theme to dark', () => {
      useThemeStore.getState().setTheme('light');
      useThemeStore.getState().setTheme('dark');
      expect(useThemeStore.getState().theme).toBe('dark');
    });

    it('sets theme to system', () => {
      mockMatchMedia.mockReturnValue({ matches: false });
      useThemeStore.getState().setTheme('system');
      expect(useThemeStore.getState().theme).toBe('system');
    });

    it('calls applyTheme on setTheme', () => {
      useThemeStore.getState().setTheme('light');
      expect(mockClassList.remove).toHaveBeenCalledWith('light', 'dark');
      expect(mockClassList.add).toHaveBeenCalledWith('light');
    });
  });

  describe('applyTheme', () => {
    it('applies dark theme', () => {
      applyTheme('dark');
      expect(mockClassList.remove).toHaveBeenCalledWith('light', 'dark');
      expect(mockClassList.add).toHaveBeenCalledWith('dark');
      expect(mockStyle.colorScheme).toBe('dark');
    });

    it('applies light theme', () => {
      applyTheme('light');
      expect(mockClassList.remove).toHaveBeenCalledWith('light', 'dark');
      expect(mockClassList.add).toHaveBeenCalledWith('light');
      expect(mockStyle.colorScheme).toBe('light');
    });

    it('resolves system theme to dark when prefers-color-scheme is dark', () => {
      mockMatchMedia.mockReturnValue({ matches: false });
      applyTheme('system');
      expect(mockClassList.add).toHaveBeenCalledWith('dark');
      expect(mockStyle.colorScheme).toBe('dark');
    });

    it('resolves system theme to light when prefers-color-scheme is light', () => {
      mockMatchMedia.mockReturnValue({ matches: true });
      applyTheme('system');
      expect(mockClassList.add).toHaveBeenCalledWith('light');
      expect(mockStyle.colorScheme).toBe('light');
    });
  });
});
