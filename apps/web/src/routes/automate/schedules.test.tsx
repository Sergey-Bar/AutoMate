/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../automate.js', () => ({
  Route: { id: 'automate' },
}));

vi.mock('../../hooks/useSchedules.js', () => ({
  useSchedules: vi.fn(),
}));

vi.mock('../../components/automate/ScheduleCard.js', () => ({
  ScheduleCard: ({
    schedule,
    onEdit,
    onDelete,
    onToggle,
  }: {
    schedule: { id: string; name: string; enabled: boolean };
    onEdit?: (s: { id: string; name: string; enabled: boolean }) => void;
    onDelete?: (s: { id: string; name: string; enabled: boolean }) => void;
    onToggle?: (s: { id: string; name: string; enabled: boolean }, enabled: boolean) => void;
  }) => (
    <div data-testid={`schedule-card-${schedule.id}`}>
      <span data-testid={`schedule-name-${schedule.id}`}>{schedule.name}</span>
      <button
        data-testid={`edit-${schedule.id}`}
        onClick={() => onEdit?.(schedule)}
      >
        Edit
      </button>
      <button
        data-testid={`delete-${schedule.id}`}
        onClick={() => onDelete?.(schedule)}
      >
        Delete
      </button>
      <button
        data-testid={`toggle-${schedule.id}`}
        onClick={() => onToggle?.(schedule, !schedule.enabled)}
      >
        Toggle
      </button>
    </div>
  ),
}));

vi.mock('../../components/automate/ScheduleForm.js', () => ({
  ScheduleForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (input: {
      name: string;
      cron: string;
      suiteId: string;
      enabled: boolean;
    }) => void | Promise<void>;
    onCancel?: () => void;
    isSubmitting?: boolean;
  }) => (
    <div data-testid="schedule-form">
      <button
        data-testid="submit-form"
        onClick={() =>
          onSubmit({
            name: 'Test Schedule',
            cron: '0 * * * *',
            suiteId: 'suite-1',
            enabled: true,
          })
        }
      >
        Submit
      </button>
      {onCancel && (
        <button data-testid="cancel-form" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  ),
}));

vi.mock('@automate/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@automate/ui')>();
  return {
    ...mod,
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) =>
      open ? (
        <div data-dialog-open="true">
          {children}
          <button
            data-testid="mock-dialog-close"
            onClick={() => onOpenChange?.(false)}
          >
            ×
          </button>
          <button
            data-testid="mock-dialog-reopen"
            onClick={() => onOpenChange?.(true)}
          >
            reopen
          </button>
        </div>
      ) : null,
    DialogContent: ({
      children,
      'data-testid': testId,
    }: {
      children: React.ReactNode;
      'data-testid'?: string;
    }) => <div data-testid={testId}>{children}</div>,
    DialogHeader: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

import { SchedulesPage, Route as SchedulesRoute } from './schedules.js';
import { useSchedules } from '../../hooks/useSchedules.js';
import type { Schedule } from '../../hooks/useSchedules.js';

const mockSchedule1: Schedule = {
  id: 'sched-1',
  name: 'Nightly Regression',
  cron: '0 2 * * *',
  suiteId: 'suite-1',
  enabled: true,
  lastRun: '2024-01-01T00:00:00Z',
  nextRun: '2024-01-02T02:00:00Z',
};

const mockSchedule2: Schedule = {
  id: 'sched-2',
  name: 'Weekly Smoke',
  cron: '0 9 * * 1',
  suiteId: 'suite-2',
  enabled: false,
};

const mockSchedules = [mockSchedule1, mockSchedule2];

function makeReturn(overrides: Partial<ReturnType<typeof useSchedules>> = {}): ReturnType<typeof useSchedules> {
  return {
    data: [],
    isLoading: false,
    error: null,
    reload: vi.fn().mockResolvedValue(undefined) as ReturnType<typeof useSchedules>['reload'],
    createSchedule: vi.fn().mockResolvedValue(mockSchedule1) as ReturnType<typeof useSchedules>['createSchedule'],
    updateSchedule: vi.fn().mockResolvedValue(mockSchedule1) as ReturnType<typeof useSchedules>['updateSchedule'],
    deleteSchedule: vi.fn().mockResolvedValue(undefined) as ReturnType<typeof useSchedules>['deleteSchedule'],
    toggleSchedule: vi.fn().mockResolvedValue(mockSchedule1) as ReturnType<typeof useSchedules>['toggleSchedule'],
    ...overrides,
  };
}

describe('SchedulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page container and heading', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    expect(screen.getByTestId('schedules-page')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Runs')).toBeInTheDocument();
    expect(screen.getByText(/Automate test suite execution/)).toBeInTheDocument();
  });

  it('renders Add Schedule button', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    expect(screen.getByTestId('add-schedule-button')).toBeInTheDocument();
  });

  it('renders loading skeleton while isLoading is true', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ isLoading: true }));
    render(<SchedulesPage />);
    expect(screen.getByTestId('schedules-loading')).toBeInTheDocument();
  });

  it('does not show loading when isLoading is false', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ isLoading: false }));
    render(<SchedulesPage />);
    expect(screen.queryByTestId('schedules-loading')).not.toBeInTheDocument();
  });

  it('renders error message when error is set and not loading', () => {
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ error: new Error('Failed to fetch schedules: 500'), isLoading: false })
    );
    render(<SchedulesPage />);
    expect(screen.getByTestId('schedules-error')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch schedules: 500')).toBeInTheDocument();
  });

  it('does not render error when isLoading is true even if error set', () => {
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ error: new Error('err'), isLoading: true })
    );
    render(<SchedulesPage />);
    expect(screen.queryByTestId('schedules-error')).not.toBeInTheDocument();
  });

  it('renders empty state when no schedules and not loading', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: [], isLoading: false }));
    render(<SchedulesPage />);
    expect(screen.getByTestId('schedules-empty')).toBeInTheDocument();
    expect(screen.getByText(/No schedules configured/)).toBeInTheDocument();
  });

  it('does not render empty state when schedules exist', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules, isLoading: false }));
    render(<SchedulesPage />);
    expect(screen.queryByTestId('schedules-empty')).not.toBeInTheDocument();
  });

  it('does not render empty state while loading', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: [], isLoading: true }));
    render(<SchedulesPage />);
    expect(screen.queryByTestId('schedules-empty')).not.toBeInTheDocument();
  });

  it('renders schedule grid with a card per schedule', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules, isLoading: false }));
    render(<SchedulesPage />);
    expect(screen.getByTestId('schedules-grid')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-card-sched-1')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-card-sched-2')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-name-sched-1')).toHaveTextContent('Nightly Regression');
  });

  it('does not render grid when no schedules', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: [], isLoading: false }));
    render(<SchedulesPage />);
    expect(screen.queryByTestId('schedules-grid')).not.toBeInTheDocument();
  });

  // ─── Create dialog ──────────────────────────────────────────────────────────

  it('does not show create dialog by default', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    expect(screen.queryByTestId('create-schedule-dialog')).not.toBeInTheDocument();
  });

  it('opens create dialog when Add Schedule button is clicked', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    expect(screen.getByTestId('create-schedule-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-form')).toBeInTheDocument();
  });

  it('closes create dialog when cancel button is clicked', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    expect(screen.getByTestId('create-schedule-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cancel-form'));
    expect(screen.queryByTestId('create-schedule-dialog')).not.toBeInTheDocument();
  });

  it('calls createSchedule with form input on submit', async () => {
    const createSchedule = vi.fn().mockResolvedValue(mockSchedule1);
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ createSchedule }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    fireEvent.click(screen.getByTestId('submit-form'));
    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledWith({
        name: 'Test Schedule',
        cron: '0 * * * *',
        suiteId: 'suite-1',
        enabled: true,
      });
    });
  });

  it('closes create dialog after successful submit', async () => {
    const createSchedule = vi.fn().mockResolvedValue(mockSchedule1);
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ createSchedule }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    fireEvent.click(screen.getByTestId('submit-form'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-schedule-dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps create dialog open when createSchedule throws', async () => {
    const createSchedule = vi.fn().mockRejectedValue(new Error('API error'));
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ createSchedule }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    fireEvent.click(screen.getByTestId('submit-form'));
    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalled();
    });
    // dialog stays open — setShowForm(false) is only called in the try branch
    expect(screen.getByTestId('create-schedule-dialog')).toBeInTheDocument();
  });

  // ─── Edit dialog ────────────────────────────────────────────────────────────

  it('does not show edit dialog by default', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules }));
    render(<SchedulesPage />);
    expect(screen.queryByTestId('edit-schedule-dialog')).not.toBeInTheDocument();
  });

  it('opens edit dialog when edit button is clicked on a card', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules, isLoading: false }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    expect(screen.getByTestId('edit-schedule-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-form')).toBeInTheDocument();
  });

  it('closes edit dialog when cancel button is clicked', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules, isLoading: false }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    expect(screen.getByTestId('edit-schedule-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cancel-form'));
    expect(screen.queryByTestId('edit-schedule-dialog')).not.toBeInTheDocument();
  });

  it('calls updateSchedule with schedule id and form input on edit submit', async () => {
    const updateSchedule = vi.fn().mockResolvedValue(mockSchedule1);
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ data: mockSchedules, isLoading: false, updateSchedule })
    );
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    fireEvent.click(screen.getByTestId('submit-form'));
    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith('sched-1', {
        name: 'Test Schedule',
        cron: '0 * * * *',
        suiteId: 'suite-1',
        enabled: true,
      });
    });
  });

  it('closes edit dialog after successful update', async () => {
    const updateSchedule = vi.fn().mockResolvedValue(mockSchedule1);
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ data: mockSchedules, isLoading: false, updateSchedule })
    );
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    fireEvent.click(screen.getByTestId('submit-form'));
    await waitFor(() => {
      expect(screen.queryByTestId('edit-schedule-dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps edit dialog open when updateSchedule throws', async () => {
    const updateSchedule = vi.fn().mockRejectedValue(new Error('Update error'));
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ data: mockSchedules, isLoading: false, updateSchedule })
    );
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    fireEvent.click(screen.getByTestId('submit-form'));
    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalled();
    });
    expect(screen.getByTestId('edit-schedule-dialog')).toBeInTheDocument();
  });

  // ─── Delete & toggle ────────────────────────────────────────────────────────

  it('calls deleteSchedule with schedule id when delete is clicked', async () => {
    const deleteSchedule = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ data: mockSchedules, isLoading: false, deleteSchedule })
    );
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('delete-sched-1'));
    await waitFor(() => {
      expect(deleteSchedule).toHaveBeenCalledWith('sched-1');
    });
  });

  it('calls toggleSchedule with id and inverted enabled for enabled schedule', async () => {
    const toggleSchedule = vi.fn().mockResolvedValue(mockSchedule1);
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ data: mockSchedules, isLoading: false, toggleSchedule })
    );
    render(<SchedulesPage />);
    // sched-1 enabled=true → toggle calls with false
    fireEvent.click(screen.getByTestId('toggle-sched-1'));
    await waitFor(() => {
      expect(toggleSchedule).toHaveBeenCalledWith('sched-1', false);
    });
  });

  it('calls toggleSchedule with true for a disabled schedule', async () => {
    const toggleSchedule = vi.fn().mockResolvedValue(mockSchedule2);
    vi.mocked(useSchedules).mockReturnValue(
      makeReturn({ data: mockSchedules, isLoading: false, toggleSchedule })
    );
    render(<SchedulesPage />);
    // sched-2 enabled=false → toggle calls with true
    fireEvent.click(screen.getByTestId('toggle-sched-2'));
    await waitFor(() => {
      expect(toggleSchedule).toHaveBeenCalledWith('sched-2', true);
    });
  });

  // ─── onOpenChange coverage ──────────────────────────────────────────────────

  it('create dialog onOpenChange(false) closes create dialog via mock close button', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    expect(screen.getByTestId('create-schedule-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-dialog-close'));
    expect(screen.queryByTestId('create-schedule-dialog')).not.toBeInTheDocument();
  });

  it('create dialog onOpenChange(true) keeps create dialog open', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('add-schedule-button'));
    expect(screen.getByTestId('create-schedule-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-dialog-reopen'));
    expect(screen.getByTestId('create-schedule-dialog')).toBeInTheDocument();
  });

  it('edit dialog onOpenChange(false) closes edit dialog via mock close button', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules, isLoading: false }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    expect(screen.getByTestId('edit-schedule-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-dialog-close'));
    expect(screen.queryByTestId('edit-schedule-dialog')).not.toBeInTheDocument();
  });

  it('edit dialog onOpenChange(true) does not close edit dialog', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn({ data: mockSchedules, isLoading: false }));
    render(<SchedulesPage />);
    fireEvent.click(screen.getByTestId('edit-sched-1'));
    expect(screen.getByTestId('edit-schedule-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-dialog-reopen'));
    expect(screen.getByTestId('edit-schedule-dialog')).toBeInTheDocument();
  });

  // ─── Route options ──────────────────────────────────────────────────────────

  it('Route.options.getParentRoute returns defined parent', () => {
    const opts = (SchedulesRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('Route.options.component lambda renders SchedulesPage', () => {
    vi.mocked(useSchedules).mockReturnValue(makeReturn());
    const opts = (SchedulesRoute as unknown as { options: { component: () => React.JSX.Element } }).options;
    render(opts.component());
    expect(screen.getByTestId('schedules-page')).toBeInTheDocument();
  });
});
