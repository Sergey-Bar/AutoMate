/// <reference types="vitest/globals" />
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle.js';
import { useTheme } from '../theme/ThemeProvider.js';

vi.mock('../theme/ThemeProvider.js', () => ({
  useTheme: vi.fn(),
}));

describe('ThemeToggle', () => {
  const mockSetTheme = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with dark theme', () => {
    vi.mocked(useTheme).mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    render(<ThemeToggle />);
    const button = screen.getByTestId('theme-toggle');
    expect(button).toBeTruthy();
    expect(button.getAttribute('title')).toContain('dark');
  });

  it('cycles theme dark -> light', () => {
    vi.mocked(useTheme).mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('cycles theme light -> system', () => {
    vi.mocked(useTheme).mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('cycles theme system -> dark', () => {
    vi.mocked(useTheme).mockReturnValue({ theme: 'system', setTheme: mockSetTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });
});
