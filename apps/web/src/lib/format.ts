/**
 * Date rendering shared by the dashboard routes.
 *
 * The fallback is a required parameter rather than an option with a default. The
 * three definitions this replaced rendered `'Not started'` on the runs list and
 * `'UNKNOWN'` on run detail, and those are different claims: one says the run
 * never began, the other says the field is unknown. A default would have picked
 * one of them silently and turned a refactor into a product change.
 *
 * Locale behaviour is deliberately unchanged. `toLocaleString()` is what every
 * call site already rendered, and switching to an explicit `Intl.DateTimeFormat`
 * with a time zone is a separate change that alters output.
 */
export function formatDate(value: string | null | undefined, emptyState: string): string {
  return value ? new Date(value).toLocaleString() : emptyState;
}
