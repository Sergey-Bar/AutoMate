import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, useThemeStore } from './themeStore';

const mockClassList = {
  add: vi.fn(),
  remove: vi.fn(),
};

const mockStyle = {
  colorScheme: '',
};

const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageMap.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storageMap.delete(key);
  }),
  clear: vi.fn(() => {
    storageMap.clear();
  }),
};

const origDocument = globalThis.document;
const origWindow = globalThis.window;
const origLocalStorage = globalThis.localStorage;

beforeAll(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      documentElement: {
        classList: mockClassList,
        style: mockStyle,
      },
    },
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      ...(origWindow ?? {}),
      matchMedia: vi.fn(),
    },
  });

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: mockLocalStorage,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: origDocument,
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: origWindow,
  });

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: origLocalStorage,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMap.clear();
  mockStyle.colorScheme = '';
  useThemeStore.setState({
    theme: 'dark',
    setTheme: useThemeStore.getState().setTheme,
  });
});

describe('applyTheme', () => {
  it("applies dark theme to document root", () => {
    applyTheme('dark');

    expect(mockClassList.remove).toHaveBeenCalledWith('light', 'dark');
    expect(mockClassList.add).toHaveBeenCalledWith('dark');
    expect(mockStyle.colorScheme).toBe('dark');
  });

  it("applies light theme to document root", () => {
    applyTheme('light');

    expect(mockClassList.remove).toHaveBeenCalledWith('light', 'dark');
    expect(mockClassList.add).toHaveBeenCalledWith('light');
    expect(mockStyle.colorScheme).toBe('light');
  });

  it('resolves system theme to light when media query matches light preference', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);

    applyTheme('system');

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: light)');
    expect(mockClassList.add).toHaveBeenCalledWith('light');
    expect(mockStyle.colorScheme).toBe('light');
  });

  it('resolves system theme to dark when media query does not match light preference', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);

    applyTheme('system');

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: light)');
    expect(mockClassList.add).toHaveBeenCalledWith('dark');
    expect(mockStyle.colorScheme).toBe('dark');
  });
});

describe('useThemeStore', () => {
  it("defaults to 'dark' theme", () => {
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('setTheme updates store state and applies selected theme', () => {
    useThemeStore.getState().setTheme('light');

    expect(useThemeStore.getState().theme).toBe('light');
    expect(mockClassList.remove).toHaveBeenCalledWith('light', 'dark');
    expect(mockClassList.add).toHaveBeenCalledWith('light');
    expect(mockStyle.colorScheme).toBe('light');
  });
});
