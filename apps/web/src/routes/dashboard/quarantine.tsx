import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useQuarantine } from '../../hooks/useDashboard.js';
import { EmptyState } from '@automate/ui';
import type { ApiClient, QuarantineEntry } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/quarantine',
  component: () => <QuarantinePage />,
});

/**
 * The colour each verdict is painted in, and it has to agree with the word.
 *
 * This started life as a nested ternary, and the two non-obvious branches were
 * both inverted: `approved` was `text-error` and `rejected` was `text-success`.
 * On the screen whose whole job is to say which is which, an approval rendered in
 * the failure colour and a rejection in the pass colour is worse than no colour at
 * all — a reader scanning for red finds the one entry that passed review.
 *
 * Typed as `Partial<Record<...>>` rather than `Record<...>` on purpose. The key
 * set is `QuarantineEntry['status']`, so adding a verdict to the API schema makes
 * this table visibly incomplete, and the fallback below answers "we do not know
 * this verdict" in the neutral muted colour rather than inheriting `pending`'s
 * amber. A `Record` would have forced a placeholder nobody wanted to write.
 */
const QUARANTINE_STATUS_TONE: Partial<Record<QuarantineEntry['status'], string>> = {
  approved: 'text-success',
  rejected: 'text-danger',
  pending: 'text-warning',
};

export function QuarantinePage({ api }: { api?: ApiClient }) {
  const { data, isLoading, error, addQuarantine } = useQuarantine(api);
  const [isAdding, setIsAdding] = useState(false);
  const [testTitle, setTestTitle] = useState('');
  const [testFile, setTestFile] = useState('');
  const [reason, setReason] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div data-testid="quarantine-loading" className="p-8">
        Loading quarantine list...
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        data-testid="quarantine-error"
        title="Error Loading Quarantine List"
        description={error.message}
      />
    );
  }

  /**
   * React does not await an onSubmit handler, so the value it returns is
   * discarded and a rejection would be unhandled rather than rendered. The wrapper
   * discards the promise *after* the async body has already attached its own
   * catch, which is what makes a failed add visible in the error state.
   */
  const addAsync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTitle || !testFile) return;
    setAddError(null);
    try {
      await addQuarantine({ testTitle, testFile, reason: reason || undefined });
      setTestTitle('');
      setTestFile('');
      setReason('');
      setIsAdding(false);
    } catch (err) {
      // Shown, not just logged. This caught the failure with `console.error` and
      // nothing else, so a rejected add — a 409 because the test is already
      // quarantined, a 422 on the file path — left the form sitting there with
      // the reader's text still in it and no indication that anything had been
      // attempted. Submitting again is the obvious next move, and it fails the
      // same way for the same invisible reason.
      //
      // The form is deliberately left populated: clearing the fields on a failure
      // would discard the work, which is the second way to lose it.
      setAddError(err instanceof Error ? err.message : 'Could not add the test to quarantine');
    }
  };

  return (
    <div data-testid="quarantine-page" className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-text-primary">Quarantine Management</h2>
        <button
          data-testid="add-quarantine-btn"
          className="px-4 py-2 bg-brand-500 text-on-fill rounded-md hover:bg-brand-700"
          onClick={() => {
            setIsAdding(!isAdding);
            setAddError(null);
          }}
        >
          {isAdding ? 'Cancel' : 'Add to Quarantine'}
        </button>
      </div>

      {isAdding && (
        <form
          data-testid="quarantine-form"
          onSubmit={(event) => void addAsync(event)}
          className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4"
        >
          <h3 className="text-lg font-medium text-text-primary">Quarantine a Test</h3>
          <div>
            <label
              htmlFor="quarantine-test-title"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Test Title
            </label>
            <input
              id="quarantine-test-title"
              data-testid="input-test-title"
              type="text"
              required
              className="w-full p-2 rounded border border-border-default bg-bg-primary text-text-primary"
              value={testTitle}
              onChange={(e) => setTestTitle(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="quarantine-test-file"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Test File
            </label>
            <input
              id="quarantine-test-file"
              data-testid="input-test-file"
              type="text"
              required
              className="w-full p-2 rounded border border-border-default bg-bg-primary text-text-primary"
              value={testFile}
              onChange={(e) => setTestFile(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="quarantine-reason"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Reason (optional)
            </label>
            <input
              id="quarantine-reason"
              data-testid="input-reason"
              type="text"
              className="w-full p-2 rounded border border-border-default bg-bg-primary text-text-primary"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <button
            data-testid="submit-quarantine-btn"
            type="submit"
            className="px-4 py-2 bg-brand-500 text-on-fill rounded-md hover:bg-brand-700"
          >
            Submit
          </button>
          {addError && (
            <div role="alert" data-testid="quarantine-add-error" className="text-sm text-error">
              {addError}
            </div>
          )}
        </form>
      )}

      {data.length === 0 ? (
        <EmptyState
          data-testid="quarantine-empty"
          title="No Quarantined Tests"
          description="There are currently no tests in quarantine."
        />
      ) : (
        <div data-testid="quarantine-list" className="space-y-4">
          {data.map((entry) => (
            <div
              key={entry.id}
              data-testid={`quarantine-item-${entry.id}`}
              className="bg-bg-elevated border border-border-default rounded-lg p-4"
            >
              <div className="font-medium text-text-primary">{entry.testTitle}</div>
              <div className="text-sm text-text-secondary">{entry.testFile}</div>
              {entry.reason && (
                <div className="text-sm text-warning mt-2">Reason: {entry.reason}</div>
              )}
              {/*
                The status is the point of the list, and the colour is the part a
                reader trusts fastest, so it has to agree with the word.

                It did not. `approved` was `text-error` and `rejected` was
                `text-success` — an approval rendered in the failure colour and a
                rejection in the pass colour, on the screen whose entire job is to
                say which is which. Both branches are now the plain verdict: green
                for approved, danger for rejected, warning for pending, and
                `text-text-secondary` for a status this component does not know,
                which is what an unrecognised value deserves rather than being
                silently coloured as "pending".

                `pending` still means quarantined but undecided, so it counts in
                the pass rate; `approved` is the decision that removes it. Showing
                the file without that is how a reader concludes every entry listed
                here is already excluded, which is false for every entry until
                somebody acts on it.
              */}
              <div
                data-testid={`quarantine-status-${entry.id}`}
                className={`text-sm mt-2 ${QUARANTINE_STATUS_TONE[entry.status] ?? 'text-text-secondary'}`}
              >
                Status: {entry.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
