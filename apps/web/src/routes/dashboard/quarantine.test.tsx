import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuarantinePage } from './quarantine.js';
import type { ApiClient, QuarantineEntry } from '../../lib/api.js';

/**
 * The quarantine page, which shipped at 6.89% line coverage — a route a reader
 * reaches from the sidebar with no test behind it.
 *
 * The behaviour that needed one most was a *failure*. A rejected add was caught
 * with `console.error` and nothing else, so a reader who submitted a test that
 * was already quarantined saw the form sit there with their text still in it and
 * no sign that anything had happened. Submitting again is the obvious next move
 * and it fails identically.
 */
const entry: QuarantineEntry = {
  id: 'q-1',
  testTitle: 'checkout accepts a negative total',
  testFile: 'tests/checkout.spec.ts',
  reason: 'flaky on CI',
  quarantinedAt: '2026-09-29T00:00:00.000Z',
  status: 'pending',
};

/** An API stub whose quarantine calls are individually controllable. */
function stubApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getQuarantine: vi.fn().mockResolvedValue([entry]),
    addQuarantine: vi.fn().mockResolvedValue({ ...entry, id: 'q-2' }),
    ...overrides,
  } as unknown as ApiClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuarantinePage', () => {
  it('lists a quarantined test with its status, which is the point of the list', async () => {
    render(<QuarantinePage api={stubApi()} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());
    expect(screen.getByText(entry.testTitle)).toBeInTheDocument();
    expect(screen.getByText(entry.testFile)).toBeInTheDocument();
    expect(screen.getByTestId('quarantine-status-q-1')).toHaveTextContent('Status: pending');
  });

  it('says so when there is nothing in quarantine', async () => {
    render(<QuarantinePage api={stubApi({ getQuarantine: vi.fn().mockResolvedValue([]) })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-empty')).toBeInTheDocument());
  });

  it('reports a failed load rather than rendering an empty list', async () => {
    // An empty list and a failed load look identical on screen unless one of them
    // says so, and "no tests are quarantined" is a very different claim from "I
    // could not ask".
    render(
      <QuarantinePage
        api={stubApi({
          getQuarantine: vi.fn().mockRejectedValue(new Error('quarantine unavailable')),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-error')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-error')).toHaveTextContent('quarantine unavailable');
    expect(screen.queryByTestId('quarantine-empty')).not.toBeInTheDocument();
  });

  it('shows a rejected add to the reader and keeps their text', async () => {
    const addQuarantine = vi.fn().mockRejectedValue(new Error('already quarantined'));
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    // The failure is on screen, in the form, with the reader's work intact.
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-add-error')).toHaveTextContent('already quarantined');
    expect((screen.getByTestId('input-test-title') as HTMLInputElement).value).toBe('a new test');
  });

  it('does not log the failure and hide it', async () => {
    // The defect was `console.error(err)` and nothing else, so the only trace was
    // in a console nobody reads. Asserted explicitly: a regression back to a bare
    // console call would leave the rendered error present *and* reintroduce the
    // leak, and this is what says no.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <QuarantinePage
        api={stubApi({ addQuarantine: vi.fn().mockRejectedValue(new Error('nope')) })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('input-test-file'), { target: { value: 'y.spec.ts' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('clears a previous error when the form is reopened', async () => {
    const addQuarantine = vi.fn().mockRejectedValue(new Error('nope'));
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('input-test-file'), { target: { value: 'y.spec.ts' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));
    await waitFor(() => expect(screen.getByTestId('quarantine-add-error')).toBeInTheDocument());

    // Reopening is a new attempt; the old message must not describe it.
    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    expect(screen.queryByTestId('quarantine-add-error')).not.toBeInTheDocument();
  });

  it('adds a test and closes the form on success', async () => {
    const addQuarantine = vi.fn().mockResolvedValue({ ...entry, id: 'q-2' });
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.change(screen.getByTestId('input-reason'), { target: { value: 'flaky' } });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    await waitFor(() => expect(screen.queryByTestId('quarantine-form')).not.toBeInTheDocument());
    expect(addQuarantine).toHaveBeenCalledWith({
      testTitle: 'a new test',
      testFile: 'tests/new.spec.ts',
      reason: 'flaky',
    });
  });

  it('omits an empty reason rather than sending a blank one', async () => {
    const addQuarantine = vi.fn().mockResolvedValue({ ...entry, id: 'q-2' });
    render(<QuarantinePage api={stubApi({ addQuarantine })} />);
    await waitFor(() => expect(screen.getByTestId('quarantine-item-q-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('add-quarantine-btn'));
    fireEvent.change(screen.getByTestId('input-test-title'), { target: { value: 'a new test' } });
    fireEvent.change(screen.getByTestId('input-test-file'), {
      target: { value: 'tests/new.spec.ts' },
    });
    fireEvent.click(screen.getByTestId('submit-quarantine-btn'));

    await waitFor(() => expect(addQuarantine).toHaveBeenCalled());
    expect(addQuarantine).toHaveBeenCalledWith({
      testTitle: 'a new test',
      testFile: 'tests/new.spec.ts',
      reason: undefined,
    });
  });

  it('renders an approved entry differently from a pending one', async () => {
    // The comment in the component says why: showing the file without the status
    // leads a reader to conclude every entry is already excluded from the pass
    // rate, which is false until somebody acts on it.
    render(
      <QuarantinePage
        api={stubApi({
          getQuarantine: vi.fn().mockResolvedValue([{ ...entry, status: 'approved' }]),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quarantine-status-q-1')).toBeInTheDocument());
    expect(screen.getByTestId('quarantine-status-q-1')).toHaveTextContent('Status: approved');
  });
});
