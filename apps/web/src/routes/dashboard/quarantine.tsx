import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useQuarantine } from '../../hooks/useDashboard.js';
import {
  Badge,
  DefinitionList,
  DefinitionListDetail,
  DefinitionListTerm,
  EmptyState,
  type BadgeProps,
} from '@automate/ui';
import type { ApiClient, QuarantineEntry } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

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
/**
 * The verdict-to-tone table, and why it maps to a Badge variant rather than to a class.
 *
 * It used to hold CSS classes (	ext-success, 	ext-danger, 	ext-warning) applied to a
 * <div>, which meant **the word and the colour were two elements** and a verdict could read
 * "approved" in amber. The mapping itself was right and the mechanism was the defect, so the
 * table stays and its values became Badge variants — one element that owns both.
 */
const QUARANTINE_STATUS_TONE: Partial<Record<QuarantineEntry['status'], BadgeProps['variant']>> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
};

/**
 * The tone for a verdict this component does not recognise.
 *
 * undefined rather than 'warning', because inheriting pending's amber for a verdict the
 * API added last week tells a reader that somebody still has to look at it. The Badge
 * default variant is the neutral pill, which says the same thing as the text and nothing more.
 */
const UNKNOWN_STATUS_TONE = 'default';

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
        <h1 className="text-balance text-3xl font-bold text-text-primary">Quarantine Management</h1>
        <button
          data-testid="add-quarantine-btn"
          className="px-4 py-2 bg-brand-500 text-on-fill rounded-md hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
          <h2 className="font-medium text-lg text-text-primary">Quarantine a Test</h2>
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
            className="px-4 py-2 bg-brand-500 text-on-fill rounded-md hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
            <div key={entry.id} data-testid={`quarantine-item-${entry.id}`}>
              {/*
                A row with a surface, and its facts in a definition list.
              *
              * **Both halves are the primitives the plan said were missing.** The entry was
              * four sibling `<div>`s — title, file, reason, status — which is a definition
              * list that no screen reader can read as one: `DefinitionListDetail` is a `<dd>`,
              * so the pair is announced as a unit rather than as four strings. And the row had
              * no hover or focus treatment, so a list a person scans with their eye gave the
              * eye nothing to track — the same defect the Cockpit's queue had and the same
              * fix, because it is now a rule rather than a decision.

              `border-transparent` at rest and `border-border` on hover, so the resting state
              is still a list rather than a stack of boxes.
              */}
              <div className="rounded-lg border border-transparent bg-bg-elevated p-4 transition-colors hover:border-border-default">
                <DefinitionList>
                  <DefinitionListTerm>Test</DefinitionListTerm>
                  <DefinitionListDetail>{entry.testTitle}</DefinitionListDetail>

                  <DefinitionListTerm>File</DefinitionListTerm>
                  <DefinitionListDetail>{entry.testFile}</DefinitionListDetail>

                  {entry.reason === null ? null : (
                    <>
                      <DefinitionListTerm>Reason</DefinitionListTerm>
                      <DefinitionListDetail>{entry.reason}</DefinitionListDetail>
                    </>
                  )}

                  <DefinitionListTerm>Quarantined</DefinitionListTerm>
                  <DefinitionListDetail>
                    {formatDate(entry.quarantinedAt, 'not recorded')}
                  </DefinitionListDetail>

                  <DefinitionListTerm>Status</DefinitionListTerm>
                  <DefinitionListDetail>
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

                      The word and the colour now sit together in a `Badge` rather than a
                      class on a `<div>`, so the verdict cannot be read one way and
                      coloured another: one element owns both.
                    */}
                    <Badge
                      data-testid={`quarantine-status-${entry.id}`}
                      variant={QUARANTINE_STATUS_TONE[entry.status] ?? UNKNOWN_STATUS_TONE}
                    >
                      {entry.status}
                    </Badge>
                  </DefinitionListDetail>
                </DefinitionList>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
