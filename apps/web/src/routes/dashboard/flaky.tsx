import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useFlakyTests } from '../../hooks/useFlakyTests.js';
import {
  EmptyState,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@automate/ui';
import type { FlakyTest } from '../../services/flaky-detection.js';
import { FlakyFixPanel } from '../../components/dashboard/FlakyFixPanel.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/flaky',
  component: () => <FlakyPage />,
});

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  if (score >= 0.7) {
    return <Badge variant="danger">{pct}%</Badge>;
  }
  if (score >= 0.5) {
    return <Badge variant="warning">{pct}%</Badge>;
  }
  return <Badge variant="secondary">{pct}%</Badge>;
}

function ResultDots({ results }: { results: FlakyTest['recentResults'] }) {
  return (
    <div className="flex gap-1">
      {results.map((r, i) => (
        <span
          key={i}
          title={r}
          className={`inline-block w-3 h-3 rounded-full ${r === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}
        />
      ))}
    </div>
  );
}

export function FlakyPage({ fetchFn }: { fetchFn?: () => Promise<FlakyTest[]> }) {
  const { data, isLoading, error } = useFlakyTests(fetchFn);
  const [selectedTest, setSelectedTest] = useState<FlakyTest | null>(null);

  if (isLoading) {
    return <div data-testid="flaky-loading" className="p-8">Loading flaky tests...</div>;
  }

  if (error) {
    return (
      <EmptyState
        data-testid="flaky-error"
        title="Error Loading Flaky Tests"
        description={error.message}
      />
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        data-testid="flaky-empty"
        title="No Flaky Tests"
        description="No flaky tests detected. All tests are stable."
      />
    );
  }

  return (
    <div data-testid="flaky-page" className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-text-primary">Flaky Tests</h2>
        <Badge variant="warning">{data.length} flaky</Badge>
      </div>

      <div className="flex gap-6">
        <div className="flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test Name</TableHead>
                <TableHead>Suite</TableHead>
                <TableHead>Flakiness Score</TableHead>
                <TableHead>Last 10 Results</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((test) => (
                <TableRow
                  key={test.testId}
                  data-testid={`flaky-row-${test.testId}`}
                  onClick={() => setSelectedTest(test)}
                  className={`cursor-pointer hover:bg-bg-elevated ${selectedTest?.testId === test.testId ? 'bg-bg-elevated' : ''}`}
                >
                  <TableCell className="font-medium text-text-primary">{test.testName}</TableCell>
                  <TableCell className="text-text-secondary">{test.suiteName || '—'}</TableCell>
                  <TableCell>
                    <ScoreBadge score={test.flakinessScore} />
                  </TableCell>
                  <TableCell>
                    <ResultDots results={test.recentResults} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {selectedTest && (
          <div className="w-96 shrink-0" data-testid="fix-panel-container">
            <FlakyFixPanel
              test={selectedTest}
              onClose={() => setSelectedTest(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
