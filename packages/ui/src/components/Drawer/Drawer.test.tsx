import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from './Drawer.js';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(
      <Drawer open={false}>
        <DrawerContent data-testid="drawer">Content</DrawerContent>
      </Drawer>,
    );
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  // JSDOM does not fully support HTMLDialogElement, so showModal might throw or not work perfectly.
  // We'll test basic rendering for DrawerContent directly.
  it('renders content correctly', () => {
    render(
      <DrawerContent data-testid="drawer-content">
        <DrawerHeader>
          <DrawerTitle>Title</DrawerTitle>
        </DrawerHeader>
        Content
      </DrawerContent>,
    );
    expect(screen.getByTestId('drawer-content')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('applies position variants', () => {
    render(<Drawer data-testid="drawer-root" position="right" open />);
    expect(screen.getByTestId('drawer-root')).toHaveClass('right-0');
  });
});
