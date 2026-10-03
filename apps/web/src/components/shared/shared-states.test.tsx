import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EmptyState, Alert, AlertDescription, AlertTitle, Skeleton } from '@automate/ui';

/**
 * The one place the three states a screen can be in are asserted together.
 *
 * **They are `packages/ui`'s, and the application no longer has its own.** For a
 * while `apps/web/src/components/shared/` carried `EmptyState`, `ErrorState` and
 * `LoadingState` — hand-rolled, three different shapes, and imported by nothing
 * except their own test file. So a route picking one got whichever it picked, and
 * the axe sweep over "the shared states" was auditing components no screen rendered.
 *
 * The replacements are not renames and the differences are the point:
 *
 * - **`EmptyState`** → `packages/ui`'s, same name, same intent.
 * - **`ErrorState`** → `Alert` with `variant="danger"`. There is no `ErrorState` in
 *   `packages/ui`, and inventing one would have been the second family the removal
 *   was meant to end. `Alert` already carries `role="alert"`, which is what the old
 *   component's `role="alert"` was for, plus the icon slot this design uses.
 * - **`LoadingState`** → `Skeleton`, which is a placeholder rather than an
 *   announcement. The old one was an animated emoji with `role="status"`, so a
 *   screen reader said "Loading…" on every mount — including route changes, where
 *   the content behind it never went away.
 */

test('the empty state renders its heading, description and action', () => {
  const onAction = vi.fn();
  render(
    <EmptyState
      data-testid="empty"
      title="No execution evidence"
      description="No canonical runs are available."
      // A node, not `{ label, onClick }`. `packages/ui`'s `EmptyState` takes
      // `action?: ReactNode` so a caller can put a link, a button or a row of
      // buttons there; the removed application copy hard-coded the pair, which meant
      // its empty state could never hold anything else.
      action={
        <button type="button" onClick={onAction}>
          Open Command Center
        </button>
      }
    />,
  );
  expect(screen.getByRole('heading', { name: 'No execution evidence' })).toBeInTheDocument();
  expect(screen.getByText('No canonical runs are available.')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Open Command Center' });
  expect(button).toBeInTheDocument();
  button.click();
  expect(onAction).toHaveBeenCalledOnce();
});

test('the error state is an alert, so it is announced without a live region', () => {
  render(
    <Alert variant="danger" data-testid="error">
      <AlertTitle>Evidence unavailable</AlertTitle>
      <AlertDescription>The API did not answer.</AlertDescription>
    </Alert>,
  );
  // `role="alert"` is the property the old hand-rolled `ErrorState` set by hand, and
  // it is what makes a failure interrupt a screen reader rather than wait for the
  // next focus stop.
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('Evidence unavailable')).toBeInTheDocument();
});

test('the loading state is a placeholder, and is hidden from assistive technology', () => {
  render(<Skeleton data-testid="loading" />);
  const loading = screen.getByTestId('loading');
  expect(loading).toBeInTheDocument();
  // Deliberately *not* a live region. The old `LoadingState` was `role="status"`
  // with the text "Loading…", so every mount announced a state the reader had not
  // asked about — and a route change announces it again with the previous page's
  // content still on screen.
  expect(loading).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('status')).toBeNull();
});
