import { render, screen } from '@testing-library/react';
import { Alert, AlertTitle, AlertDescription } from './Alert.js';

describe('Alert', () => {
  it('renders alert', () => {
    render(<Alert data-testid="alert">Alert</Alert>);
    expect(screen.getByTestId('alert')).toBeInTheDocument();
  });
  it('renders title and description', () => {
    render(
      <Alert>
        <AlertTitle>Title</AlertTitle>
        <AlertDescription>Description</AlertDescription>
      </Alert>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });
  it('applies danger variant', () => {
    render(<Alert data-testid="alert" variant="danger" />);
    expect(screen.getByTestId('alert')).toHaveClass('text-danger');
  });
});
