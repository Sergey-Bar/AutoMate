import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoleGate } from '../RoleGate';

// Mock the hook from authStore
vi.mock('@/store/authStore', () => ({
  useUserRole: vi.fn(),
}));

import { useUserRole } from '@/store/authStore';

describe('RoleGate', () => {
  it('renders children when role is allowed', () => {
    vi.mocked(useUserRole).mockReturnValue('admin');
    
    render(
      <RoleGate allowedRoles={['admin']}>
        <div data-testid="content">Admin Content</div>
      </RoleGate>
    );
    
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders fallback when role is not allowed', () => {
    vi.mocked(useUserRole).mockReturnValue('viewer');
    
    render(
      <RoleGate allowedRoles={['admin']} fallback={<div data-testid="fallback">Access Denied</div>}>
        <div data-testid="content">Admin Content</div>
      </RoleGate>
    );
    
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('renders nothing when role is not allowed and no fallback provided', () => {
    vi.mocked(useUserRole).mockReturnValue('editor');
    
    const { container } = render(
      <RoleGate allowedRoles={['admin']}>
        <div data-testid="content">Admin Content</div>
      </RoleGate>
    );
    
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
