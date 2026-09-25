export interface ScheduleRule {
  minute: number | '*' | 'step';
  hour: number | '*';
}

export function nextOccurrence(
  rule: ScheduleRule,
  from: Date,
  intervalMinutes = 1,
): Date | undefined {
  const minute = rule.minute;
  if (minute === '*' || minute === 'step') {
    const next = new Date(from.getTime() + intervalMinutes * 60_000);
    next.setUTCSeconds(0, 0);
    return next;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Invalid minute');
  }
  if (
    typeof rule.hour !== 'number' ||
    !Number.isInteger(rule.hour) ||
    rule.hour < 0 ||
    rule.hour > 23
  ) {
    throw new Error('Invalid hour');
  }
  const next = new Date(from);
  next.setUTCMinutes(minute, 0, 0);
  next.setUTCHours(rule.hour);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
