import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card.js';

describe('Card', () => {
  it('renders card', () => {
    render(<Card data-testid="card">Card</Card>);
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });
  it('renders card with all parts', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
  it('applies custom classes', () => {
    render(<Card data-testid="card" className="custom" />);
    expect(screen.getByTestId('card')).toHaveClass('custom');
  });
});
