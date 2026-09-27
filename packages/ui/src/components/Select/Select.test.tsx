import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Select } from './Select.js';

const mockOptions = [
  { value: '1', label: 'Option 1' },
  { value: '2', label: 'Option 2' },
];

describe('Select', () => {
  it('renders without errors', () => {
    render(<Select options={mockOptions} data-testid="test-select" />);
    expect(screen.getByTestId('test-select')).toBeInTheDocument();
    expect(screen.getByText('Option 1')).toBeInTheDocument();
  });

  it('applies disabled state', () => {
    render(<Select disabled options={mockOptions} data-testid="test-select" />);
    const select = screen.getByTestId('test-select');
    expect(select).toBeDisabled();
    expect(select).toHaveClass('disabled:opacity-50');
  });

  it('renders with label and associates correctly', () => {
    render(<Select id="test-id" label="Test Label" options={mockOptions} />);
    const label = screen.getByText('Test Label');
    const select = screen.getByLabelText('Test Label');
    expect(label).toBeInTheDocument();
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute('id', 'test-id');
  });

  it('renders error message and applies error class', () => {
    render(
      <Select
        id="error-id"
        error="Error message"
        options={mockOptions}
        data-testid="test-select"
      />,
    );
    const select = screen.getByTestId('test-select');
    const errorMessage = screen.getByText('Error message');

    expect(errorMessage).toBeInTheDocument();
    expect(select).toHaveClass('border-error');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'error-id-error');
  });

  it('renders placeholder option', () => {
    render(
      <Select placeholder="Select an option" options={mockOptions} data-testid="test-select" />,
    );
    const placeholder = screen.getByText('Select an option');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute('value', '');
    expect(placeholder).toBeDisabled();
  });
});

describe('Select keyboard and labelling', () => {
  it('is a real listbox that takes focus and reports a chosen value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select id="status" label="Run status" options={mockOptions} onChange={onChange} />);

    const select = screen.getByLabelText('Run status');
    await user.tab();
    expect(select).toHaveFocus();
    // A real `<select>`, not a div with a class. If this ever stops being a
    // native control the platform's own keyboard handling goes with it, and
    // nothing in the class-name assertions would notice.
    expect(select.tagName).toBe('SELECT');
    // A single-select `<select>` is a combobox, not a listbox.
    expect(screen.getByRole('combobox')).toBe(select);

    await user.selectOptions(select, '2');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue('2');
  });

  it('skips a disabled select in the tab order', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" data-testid="before">
          Before
        </button>
        <Select id="status" label="Run status" options={mockOptions} disabled />
        <button type="button" data-testid="after">
          After
        </button>
      </div>,
    );

    await user.tab();
    expect(screen.getByTestId('before')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('after')).toHaveFocus();
  });

  it('announces a validation error through the control, not only beside it', () => {
    render(
      <Select
        id="status"
        label="Run status"
        error="Run status is not a real field"
        options={mockOptions}
      />,
    );
    const select = screen.getByLabelText('Run status');
    const message = screen.getByText('Run status is not a real field');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Run status is not a real field');
    expect(message).toHaveAttribute('id', 'status-error');
  });
});
