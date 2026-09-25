/**
 * Simple cron expression to human-readable string converter.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 */

const MONTHS: Record<string, string> = {
  '1': 'January', '2': 'February', '3': 'March', '4': 'April',
  '5': 'May', '6': 'June', '7': 'July', '8': 'August',
  '9': 'September', '10': 'October', '11': 'November', '12': 'December',
};

const DAYS_OF_WEEK: Record<string, string> = {
  '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
  '4': 'Thursday', '5': 'Friday', '6': 'Saturday',
  '7': 'Sunday',
};

function formatTime(minute: string, hour: string): string {
  if (minute === '*' || hour === '*') return 'every minute';
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  const displayMinute = m.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${period}`;
}

function parseRange(field: string, map: Record<string, string>): string {
  if (field.includes('-')) {
    const [start, end] = field.split('-');
    const startLabel = map[start] ?? start;
    const endLabel = map[end] ?? end;
    return `${startLabel} through ${endLabel}`;
  }
  return map[field] ?? field;
}

function parseList(field: string, map: Record<string, string>): string {
  const parts = field.split(',');
  const labels = parts.map(p => parseRange(p.trim(), map));
  if (labels.length === 1) return labels[0]!;
  const last = labels.pop()!;
  return `${labels.join(', ')} and ${last}`;
}

/**
 * Convert a 5-field cron expression to a human-readable description.
 * Returns null if the expression is invalid.
 */
export function parseCron(expression: string): string | null {
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];

  // Validate basic characters
  const validChars = /^[\d*,\-/]+$/;
  for (const field of [minute, hour, dom, month, dow]) {
    if (!validChars.test(field)) return null;
  }

  const timeStr = formatTime(minute, hour);

  // Every minute
  if (minute === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Every minute';
  }

  // Step values (e.g., */5 * * * *)
  if (minute.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const step = minute.slice(2);
    return `Every ${step} minutes`;
  }

  if (hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') {
    const step = hour.slice(2);
    return `Every ${step} hours`;
  }

  // Build frequency description
  let frequency = '';

  // Day-of-week based
  if (dow !== '*' && dom === '*') {
    if (dow === '1-5') {
      frequency = 'Every weekday';
    } else if (dow === '0,6' || dow === '6,0') {
      frequency = 'Every weekend';
    } else {
      const dayLabel = parseList(dow, DAYS_OF_WEEK);
      frequency = `Every ${dayLabel}`;
    }
  } else if (dom !== '*' && dow === '*') {
    // Day-of-month based
    const dayNum = parseInt(dom, 10);
    if (!isNaN(dayNum)) {
      const suffix = ordinalSuffix(dayNum);
      frequency = `On the ${dayNum}${suffix}`;
    } else {
      frequency = `On day ${dom}`;
    }
  } else if (dom !== '*' && dow !== '*') {
    frequency = 'On specific days';
  } else {
    frequency = 'Daily';
  }

  // Month restriction
  let monthStr = '';
  if (month !== '*') {
    monthStr = ` in ${parseList(month, MONTHS)}`;
  }

  // Time
  if (minute === '*' && hour === '*') {
    return `${frequency}${monthStr}, every minute`;
  }

  return `${frequency}${monthStr} at ${timeStr}`;
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Validate a cron expression. Returns true if valid.
 */
export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}
