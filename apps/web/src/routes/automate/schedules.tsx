import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import { Stack, Skeleton, Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@automate/ui';
import { useSchedules } from '../../hooks/useSchedules.js';
import { ScheduleCard } from '../../components/automate/ScheduleCard.js';
import { ScheduleForm } from '../../components/automate/ScheduleForm.js';
import type { Schedule, CreateScheduleInput } from '../../hooks/useSchedules.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: 'schedules',
  component: () => <SchedulesPage />,
});

const MOCK_SUITES = [
  { id: 'suite-1', name: 'Smoke Tests' },
  { id: 'suite-2', name: 'Regression Suite' },
  { id: 'suite-3', name: 'E2E Full' },
];

export function SchedulesPage() {
  const { data: schedules, isLoading, error, createSchedule, updateSchedule, deleteSchedule, toggleSchedule } = useSchedules();
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreate(input: CreateScheduleInput) {
    setIsSubmitting(true);
    try {
      await createSchedule(input);
      setShowForm(false);
    } catch (_err) {
      // error handled by hook
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdate(input: CreateScheduleInput) {
    if (!editingSchedule) return;
    setIsSubmitting(true);
    try {
      await updateSchedule(editingSchedule.id, input);
      setEditingSchedule(null);
    } catch (_err) {
      // error handled by hook
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(schedule: Schedule) {
    await deleteSchedule(schedule.id);
  }

  async function handleToggle(schedule: Schedule, enabled: boolean) {
    await toggleSchedule(schedule.id, enabled);
  }

  return (
    <div data-testid="schedules-page" className="p-6">
      <Stack gap={6}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Scheduled Runs</h1>
            <p className="text-sm text-fg-muted mt-1">
              Automate test suite execution on a recurring schedule
            </p>
          </div>
          <Button
            data-testid="add-schedule-button"
            onClick={() => setShowForm(true)}
          >
            Add Schedule
          </Button>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="schedules-loading">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div data-testid="schedules-error" className="text-danger text-sm">
            {error.message}
          </div>
        )}

        {!isLoading && !error && schedules.length === 0 && (
          <p data-testid="schedules-empty" className="text-fg-muted">
            No schedules configured. Click "Add Schedule" to create one.
          </p>
        )}

        {!isLoading && schedules.length > 0 && (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="schedules-grid"
          >
            {schedules.map(schedule => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                onEdit={s => setEditingSchedule(s)}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </Stack>

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={open => setShowForm(open)}>
        <DialogContent data-testid="create-schedule-dialog">
          <DialogHeader>
            <DialogTitle>Add Schedule</DialogTitle>
          </DialogHeader>
          <ScheduleForm
            suites={MOCK_SUITES}
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            isSubmitting={isSubmitting}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editingSchedule !== null} onOpenChange={open => { if (!open) setEditingSchedule(null); }}>
        <DialogContent data-testid="edit-schedule-dialog">
          <DialogHeader>
            <DialogTitle>Edit Schedule</DialogTitle>
          </DialogHeader>
          {editingSchedule && (
            <ScheduleForm
              initial={editingSchedule}
              suites={MOCK_SUITES}
              onSubmit={handleUpdate}
              onCancel={() => setEditingSchedule(null)}
              isSubmitting={isSubmitting}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
