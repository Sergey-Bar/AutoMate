import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('renders app shell main content', () => {
    render(<AppShell data-testid="appshell">Main</AppShell>);
    expect(screen.getByTestId('appshell')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
  });
  it('renders slots', () => {
    render(
      <AppShell header={<div>Header</div>} sidebar={<div>Sidebar</div>} footer={<div>Footer</div>}>
        Main Content
      </AppShell>,
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });
  it('applies custom classes', () => {
    render(<AppShell data-testid="appshell" className="custom" />);
    expect(screen.getByTestId('appshell')).toHaveClass('custom');
  });
});
