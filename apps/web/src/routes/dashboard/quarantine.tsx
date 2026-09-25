import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useQuarantine } from '../../hooks/useDashboard.js';
import { EmptyState } from '@automate/ui';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/quarantine',
  component: () => <QuarantinePage />,
});

export function QuarantinePage({ api }: { api?: ApiClient }) {
  const { data, isLoading, error, addQuarantine } = useQuarantine(api);
  const [isAdding, setIsAdding] = useState(false);
  const [testTitle, setTestTitle] = useState('');
  const [testFile, setTestFile] = useState('');
  const [reason, setReason] = useState('');

  if (isLoading) {
    return <div data-testid="quarantine-loading" className="p-8">Loading quarantine list...</div>;
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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTitle || !testFile) return;
    try {
      await addQuarantine({ testTitle, testFile, reason: reason || undefined });
      setTestTitle('');
      setTestFile('');
      setReason('');
      setIsAdding(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div data-testid="quarantine-page" className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-text-primary">Quarantine Management</h2>
        <button
          data-testid="add-quarantine-btn"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          onClick={() => setIsAdding(!isAdding)}
        >
          {isAdding ? 'Cancel' : 'Add to Quarantine'}
        </button>
      </div>

      {isAdding && (
        <form data-testid="quarantine-form" onSubmit={handleAdd} className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-medium text-text-primary">Quarantine a Test</h3>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Test Title</label>
            <input
              data-testid="input-test-title"
              type="text"
              required
              className="w-full p-2 rounded border border-border-default bg-bg-primary text-text-primary"
              value={testTitle}
              onChange={(e) => setTestTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Test File</label>
            <input
              data-testid="input-test-file"
              type="text"
              required
              className="w-full p-2 rounded border border-border-default bg-bg-primary text-text-primary"
              value={testFile}
              onChange={(e) => setTestFile(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Reason (optional)</label>
            <input
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
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Submit
          </button>
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
            <div key={entry.id} data-testid={`quarantine-item-${entry.id}`} className="bg-bg-elevated border border-border-default rounded-lg p-4">
              <div className="font-medium text-text-primary">{entry.testTitle}</div>
              <div className="text-sm text-text-secondary">{entry.testFile}</div>
              {entry.reason && (
                <div className="text-sm text-yellow-600 mt-2">Reason: {entry.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
