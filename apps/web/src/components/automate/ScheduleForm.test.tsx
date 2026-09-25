/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { ScheduleForm } from './ScheduleForm.js';
import type { Suite } from './ScheduleForm.js';
import type { Schedule } from '../../hooks/useSchedules.js';

const SUITES: Suite[] = [
  { id: 'suite-1', name: 'Smoke Tests' },
  { id: 'suite-2', name: 'Regression Tests' },
];

const VALID_CRON = '* * * * *'; // Every minute — parseCron returns 'Every minute'
const INVALID_CRON = 'not a cron';

describe('ScheduleForm', () => {
  describe('rendering', () => {
    it('renders the form element', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form')).toBeInTheDocument();
    });

    it('renders name input empty by default', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-name')).toHaveValue('');
    });

    it('renders cron input empty by default', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-cron')).toHaveValue('');
    });

    it('pre-fills name from initial prop', () => {
      const initial: Partial<Schedule> = { name: 'Nightly CI' };
      render(<ScheduleForm initial={initial} suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-name')).toHaveValue('Nightly CI');
    });

    it('pre-fills cron from initial prop', () => {
      const initial: Partial<Schedule> = { cron: '0 9 * * 1-5' };
      render(<ScheduleForm initial={initial} suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-cron')).toHaveValue('0 9 * * 1-5');
    });

    it('shows "Create Schedule" button text when no initial id', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-submit')).toHaveTextContent('Create Schedule');
    });

    it('shows "Update Schedule" button text when initial has an id', () => {
      const initial: Partial<Schedule> = { id: 'sched-1', name: 'Existing' };
      render(<ScheduleForm initial={initial} suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-submit')).toHaveTextContent('Update Schedule');
    });

    it('shows "Saving…" on submit button when isSubmitting=true', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} isSubmitting={true} />);
      expect(screen.getByTestId('schedule-form-submit')).toHaveTextContent('Saving…');
    });

    it('disables submit button when isSubmitting=true', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} isSubmitting={true} />);
      expect(screen.getByTestId('schedule-form-submit')).toBeDisabled();
    });

    it('shows Cancel button when onCancel is provided', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByTestId('schedule-form-cancel')).toBeInTheDocument();
    });

    it('hides Cancel button when onCancel is not provided', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      expect(screen.queryByTestId('schedule-form-cancel')).toBeNull();
    });

    it('renders all suites as options in the select', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      const select = screen.getByTestId('schedule-form-suite') as HTMLSelectElement;
      expect(select.options).toHaveLength(2);
      expect(select.options[0]?.text).toBe('Smoke Tests');
      expect(select.options[1]?.text).toBe('Regression Tests');
    });

    it('defaults suiteId to first suite id', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      const select = screen.getByTestId('schedule-form-suite') as HTMLSelectElement;
      expect(select.value).toBe('suite-1');
    });
  });

  describe('cron expression interactivity', () => {
    it('shows human-readable preview when valid cron is entered', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: VALID_CRON } });
      expect(screen.getByTestId('schedule-form-cron-preview')).toBeInTheDocument();
      expect(screen.getByTestId('schedule-form-cron-preview')).toHaveTextContent('Every minute');
    });

    it('shows inline cron error when invalid cron is typed', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: INVALID_CRON } });
      expect(screen.getByTestId('schedule-form-cron-error')).toHaveTextContent('Invalid cron expression');
    });

    it('does not show cron preview or error for empty cron', () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      // cron starts empty — no preview, no inline cronError
      expect(screen.queryByTestId('schedule-form-cron-preview')).toBeNull();
      expect(screen.queryByTestId('schedule-form-cron-error')).toBeNull();
    });
  });

  describe('validation on submit', () => {
    it('shows name error when submitting with empty name', async () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: VALID_CRON } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(screen.getByTestId('schedule-form-name-error')).toHaveTextContent('Name is required');
      });
    });

    it('shows cron required error when submitting with empty cron', async () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: 'My Schedule' } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(screen.getByTestId('schedule-form-cron-required')).toHaveTextContent('Cron expression is required');
      });
    });

    it('shows cron invalid error when submitting with an invalid cron', async () => {
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} />);
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: 'My Schedule' } });
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: INVALID_CRON } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(screen.getByTestId('schedule-form-cron-error')).toHaveTextContent('Invalid cron expression');
      });
    });

    it('does not call onSubmit when validation fails', async () => {
      const onSubmit = vi.fn();
      render(<ScheduleForm suites={SUITES} onSubmit={onSubmit} />);
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(screen.getByTestId('schedule-form-name-error')).toBeInTheDocument();
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('calls onSubmit with correct data on valid submission', async () => {
      const onSubmit = vi.fn();
      render(<ScheduleForm suites={SUITES} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: 'Nightly' } });
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: VALID_CRON } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith({
          name: 'Nightly',
          cron: VALID_CRON,
          suiteId: 'suite-1',
          enabled: true,
        });
      });
    });

    it('trims whitespace from name and cron before submitting', async () => {
      const onSubmit = vi.fn();
      render(<ScheduleForm suites={SUITES} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: '  Nightly  ' } });
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: ` ${VALID_CRON} ` } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Nightly', cron: VALID_CRON })
        );
      });
    });
  });

  describe('cancel button', () => {
    it('calls onCancel when Cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<ScheduleForm suites={SUITES} onSubmit={vi.fn()} onCancel={onCancel} />);
      fireEvent.click(screen.getByTestId('schedule-form-cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('suite selection', () => {
    it('updates suiteId when user selects a different suite', async () => {
      const onSubmit = vi.fn();
      render(<ScheduleForm suites={SUITES} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByTestId('schedule-form-suite'), { target: { value: 'suite-2' } });
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: 'Nightly' } });
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: VALID_CRON } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ suiteId: 'suite-2' })
        );
      });
    });
  });

  describe('enabled toggle', () => {
    it('submits with enabled=false when form initialised with enabled=false', async () => {
      const onSubmit = vi.fn();
      render(<ScheduleForm initial={{ enabled: false }} suites={SUITES} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: 'Nightly' } });
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: VALID_CRON } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ enabled: false })
        );
      });
    });

    it('defaults enabled to true', async () => {
      const onSubmit = vi.fn();
      render(<ScheduleForm suites={SUITES} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByTestId('schedule-form-name'), { target: { value: 'Nightly' } });
      fireEvent.change(screen.getByTestId('schedule-form-cron'), { target: { value: VALID_CRON } });
      fireEvent.submit(screen.getByTestId('schedule-form'));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ enabled: true })
        );
      });
    });

    it('pre-fills enabled from initial prop when false', () => {
      const initial: Partial<Schedule> = { enabled: false };
      render(<ScheduleForm initial={initial} suites={SUITES} onSubmit={vi.fn()} />);
      const toggle = screen.getByTestId('schedule-form-enabled') as HTMLInputElement;
      expect(toggle.checked).toBe(false);
    });
  });

  describe('useEffect suite initialisation', () => {
    it('updates suiteId via effect when suites change from empty to populated', () => {
      // Start with no suites but no suiteId from initial either
      const { rerender } = render(
        <ScheduleForm initial={{ suiteId: '' }} suites={[]} onSubmit={vi.fn()} />
      );
      // suiteId is '' because initial.suiteId='' and suites is empty

      rerender(
        <ScheduleForm
          initial={{ suiteId: '' }}
          suites={[{ id: 'new-suite', name: 'New Suite' }]}
          onSubmit={vi.fn()}
        />
      );

      // After rerender with suites, the effect sets suiteId to the first suite
      const select = screen.getByTestId('schedule-form-suite') as HTMLSelectElement;
      expect(select.value).toBe('new-suite');
    });
  });
});
