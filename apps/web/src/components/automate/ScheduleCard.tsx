import React from 'react';
import { Card, CardHeader, CardTitle, Badge, Button } from '@automate/ui';
import type { Schedule } from '../../hooks/useSchedules.js';
import { parseCron } from '../../services/cron-parser.js';

export interface ScheduleCardProps {
  schedule: Schedule;
  onEdit?: (schedule: Schedule) => void;
  onDelete?: (schedule: Schedule) => void;
  onToggle?: (schedule: Schedule, enabled: boolean) => void;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function ScheduleCard({ schedule, onEdit, onDelete, onToggle }: ScheduleCardProps) {
  const humanCron = parseCron(schedule.cron) ?? schedule.cron;
  const statusVariant = schedule.enabled ? ('success' as const) : ('secondary' as const);

  return (
    <Card data-testid={`schedule-card-${schedule.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" data-testid={`schedule-name-${schedule.id}`}>
            {schedule.name}
          </CardTitle>
          <Badge variant={statusVariant} data-testid={`schedule-status-${schedule.id}`}>
            {schedule.enabled ? 'enabled' : 'disabled'}
          </Badge>
        </div>
      </CardHeader>
      <div className="p-4 pt-0 space-y-3">
        <div>
          <p className="text-xs text-fg-muted uppercase tracking-wide mb-1">Schedule</p>
          <p className="text-sm font-mono" data-testid={`schedule-cron-${schedule.id}`}>
            {schedule.cron}
          </p>
          <p className="text-sm text-fg-muted" data-testid={`schedule-human-${schedule.id}`}>
            {humanCron}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-fg-muted uppercase tracking-wide mb-0.5">Last Run</p>
            <p data-testid={`schedule-last-run-${schedule.id}`}>{formatDate(schedule.lastRun)}</p>
          </div>
          <div>
            <p className="text-xs text-fg-muted uppercase tracking-wide mb-0.5">Next Run</p>
            <p data-testid={`schedule-next-run-${schedule.id}`}>{formatDate(schedule.nextRun)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            data-testid={`schedule-toggle-${schedule.id}`}
            onClick={() => onToggle?.(schedule, !schedule.enabled)}
          >
            {schedule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid={`schedule-edit-${schedule.id}`}
            onClick={() => onEdit?.(schedule)}
          >
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid={`schedule-delete-${schedule.id}`}
            onClick={() => onDelete?.(schedule)}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
