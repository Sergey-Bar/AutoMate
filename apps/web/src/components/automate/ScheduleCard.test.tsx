/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockParseCron = vi.fn();

vi.mock('../../services/cron-parser.js', () => ({
  parseCron: (...args: unknown[]) => mockParseCron(...args),
}));

import { ScheduleCard } from './ScheduleCard.js';
import type { Schedule } from '../../hooks/useSchedules.js';

const enabledSchedule: Schedule = {
  id: 'sched-1',
  name: 'Nightly Regression',
  cron: '0 0 * * *',
  suiteId: 'suite-1',
  enabled: true,
  lastRun: '2024-01-15T00:00:00.000Z',
  nextRun: '2024-01-16T00:00:00.000Z',
};

const disabledSchedule: Schedule = {
  id: 'sched-2',
  name: 'Weekly Smoke',
  cron: '0 9 * * 1',
  suiteId: 'suite-2',
  enabled: false,
};

beforeEach(() => {
  mockParseCron.mockReturnValue('Daily at 12:00 AM');
});

describe('ScheduleCard', () => {
  it('renders the card with correct testid', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-card-${enabledSchedule.id}`)).toBeInTheDocument();
  });

  it('renders the schedule name', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-name-${enabledSchedule.id}`)).toHaveTextContent('Nightly Regression');
  });

  it('shows "enabled" badge for an enabled schedule', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-status-${enabledSchedule.id}`)).toHaveTextContent('enabled');
  });

  it('shows "disabled" badge for a disabled schedule', () => {
    render(<ScheduleCard schedule={disabledSchedule} />);
    expect(screen.getByTestId(`schedule-status-${disabledSchedule.id}`)).toHaveTextContent('disabled');
  });

  it('renders the raw cron expression', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-cron-${enabledSchedule.id}`)).toHaveTextContent('0 0 * * *');
  });

  it('renders the human-readable cron text when parseCron returns a string', () => {
    mockParseCron.mockReturnValue('Daily at 12:00 AM');
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-human-${enabledSchedule.id}`)).toHaveTextContent('Daily at 12:00 AM');
  });

  it('falls back to raw cron when parseCron returns null', () => {
    mockParseCron.mockReturnValue(null);
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-human-${enabledSchedule.id}`)).toHaveTextContent('0 0 * * *');
  });

  it('renders formatted lastRun date when provided', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    const lastRun = screen.getByTestId(`schedule-last-run-${enabledSchedule.id}`);
    // Should not be dash, should contain a date string
    expect(lastRun.textContent).not.toBe('—');
  });

  it('renders "—" for missing lastRun', () => {
    render(<ScheduleCard schedule={disabledSchedule} />);
    expect(screen.getByTestId(`schedule-last-run-${disabledSchedule.id}`)).toHaveTextContent('—');
  });

  it('renders formatted nextRun date when provided', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    const nextRun = screen.getByTestId(`schedule-next-run-${enabledSchedule.id}`);
    expect(nextRun.textContent).not.toBe('—');
  });

  it('renders "—" for missing nextRun', () => {
    render(<ScheduleCard schedule={disabledSchedule} />);
    expect(screen.getByTestId(`schedule-next-run-${disabledSchedule.id}`)).toHaveTextContent('—');
  });

  it('shows "Disable" toggle button for an enabled schedule', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-toggle-${enabledSchedule.id}`)).toHaveTextContent('Disable');
  });

  it('shows "Enable" toggle button for a disabled schedule', () => {
    render(<ScheduleCard schedule={disabledSchedule} />);
    expect(screen.getByTestId(`schedule-toggle-${disabledSchedule.id}`)).toHaveTextContent('Enable');
  });

  it('calls onToggle(schedule, false) when Disable is clicked on an enabled schedule', () => {
    const onToggle = vi.fn();
    render(<ScheduleCard schedule={enabledSchedule} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId(`schedule-toggle-${enabledSchedule.id}`));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(enabledSchedule, false);
  });

  it('calls onToggle(schedule, true) when Enable is clicked on a disabled schedule', () => {
    const onToggle = vi.fn();
    render(<ScheduleCard schedule={disabledSchedule} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId(`schedule-toggle-${disabledSchedule.id}`));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(disabledSchedule, true);
  });

  it('calls onEdit with the schedule when Edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<ScheduleCard schedule={enabledSchedule} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId(`schedule-edit-${enabledSchedule.id}`));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(enabledSchedule);
  });

  it('calls onDelete with the schedule when Delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<ScheduleCard schedule={enabledSchedule} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId(`schedule-delete-${enabledSchedule.id}`));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(enabledSchedule);
  });

  it('does not throw when optional callbacks are omitted and buttons are clicked', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(() => {
      fireEvent.click(screen.getByTestId(`schedule-toggle-${enabledSchedule.id}`));
      fireEvent.click(screen.getByTestId(`schedule-edit-${enabledSchedule.id}`));
      fireEvent.click(screen.getByTestId(`schedule-delete-${enabledSchedule.id}`));
    }).not.toThrow();
  });

  it('renders Edit and Delete buttons', () => {
    render(<ScheduleCard schedule={enabledSchedule} />);
    expect(screen.getByTestId(`schedule-edit-${enabledSchedule.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`schedule-delete-${enabledSchedule.id}`)).toBeInTheDocument();
  });
});
