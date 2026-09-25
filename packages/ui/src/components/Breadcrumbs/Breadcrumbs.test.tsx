import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs.js';

test('renders breadcrumbs', () => {
  render(
    <Breadcrumbs
      items={[
        { label: 'Home', href: '/' },
        { label: 'Settings', href: '/settings' },
        { label: 'Profile' },
      ]}
    />
  );

  const homeLink = screen.getByText('Home');
  expect(homeLink.tagName).toBe('A');
  expect(homeLink).toHaveAttribute('href', '/');

  const settingsLink = screen.getByText('Settings');
  expect(settingsLink.tagName).toBe('A');
  expect(settingsLink).toHaveAttribute('href', '/settings');

  const profileText = screen.getByText('Profile');
  expect(profileText.tagName).toBe('SPAN'); // Last item is not a link

  // There should be 2 separators
  const separators = screen.getAllByTestId('breadcrumb-separator');
  expect(separators).toHaveLength(2);
});
