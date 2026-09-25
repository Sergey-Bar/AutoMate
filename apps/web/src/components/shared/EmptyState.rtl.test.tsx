import { render, screen, fireEvent } from '../../test/test-utils.js';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="Nothing here" description="Add something to get started." />);

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add something to get started.')).toBeInTheDocument();
  });

  it('renders without description when omitted', () => {
    render(<EmptyState title="Empty" />);

    expect(screen.getByText('Empty')).toBeInTheDocument();
  });

  it('renders CTA button and fires onCta callback', () => {
    const onCta = vi.fn();
    render(<EmptyState title="No items" cta="Create Item" onCta={onCta} />);

    const button = screen.getByRole('button', { name: 'Create Item' });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('does not render CTA button when cta prop is omitted', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render CTA button when onCta is omitted even if cta is provided', () => {
    render(<EmptyState title="Empty" cta="Click me" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders with illustration="chat"', () => {
    render(<EmptyState illustration="chat" title="Chat empty" />);
    expect(screen.getByText('Chat empty')).toBeInTheDocument();
  });

  it('renders with illustration="radar"', () => {
    render(<EmptyState illustration="radar" title="Radar empty" />);
    expect(screen.getByText('Radar empty')).toBeInTheDocument();
  });

  it('renders with illustration="inbox"', () => {
    render(<EmptyState illustration="inbox" title="Inbox empty" />);
    expect(screen.getByText('Inbox empty')).toBeInTheDocument();
  });

  it('renders with illustration="search"', () => {
    render(<EmptyState illustration="search" title="Search empty" />);
    expect(screen.getByText('Search empty')).toBeInTheDocument();
  });

  it('renders with illustration="shield"', () => {
    render(<EmptyState illustration="shield" title="Shield empty" />);
    expect(screen.getByText('Shield empty')).toBeInTheDocument();
  });

  it('renders with custom icon node when no illustration is specified', () => {
    render(
      <EmptyState title="Custom icon" icon={<span data-testid="custom-icon">★</span>} />,
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('illustration takes priority over icon when both are provided', () => {
    render(
      <EmptyState
        title="Priority test"
        illustration="chat"
        icon={<span data-testid="fallback-icon">★</span>}
      />,
    );
    // illustration renders, icon node should NOT be present
    expect(screen.queryByTestId('fallback-icon')).not.toBeInTheDocument();
  });
});
