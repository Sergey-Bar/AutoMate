import { render, screen } from '@testing-library/react';
import { Avatar, AvatarImage, AvatarFallback } from './Avatar.js';

describe('Avatar', () => {
  it('renders avatar wrapper', () => {
    render(<Avatar data-testid="avatar" />);
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });
  it('renders avatar image', () => {
    render(<AvatarImage data-testid="img" src="test.jpg" alt="test" />);
    expect(screen.getByTestId('img')).toBeInTheDocument();
  });
  it('renders avatar fallback', () => {
    render(<AvatarFallback data-testid="fb">AB</AvatarFallback>);
    expect(screen.getByTestId('fb')).toHaveTextContent('AB');
  });
  it('applies sizing variants', () => {
    render(<Avatar data-testid="avatar" size="lg" />);
    expect(screen.getByTestId('avatar')).toHaveClass('h-12');
  });
});
