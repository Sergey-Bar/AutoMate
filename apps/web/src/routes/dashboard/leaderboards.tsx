import React, { useState, useMemo } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  EmptyState,
} from '@automate/ui';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/leaderboards',
  component: () => <LeaderboardsPage />,
});

export interface LeaderboardEntry {
  testId: string;
  testName: string;
  suiteName: string;
  failureCount: number;
  avgDurationMs: number;
  flakinessScore: number;
}

type SortKey = 'failureCount' | 'avgDurationMs' | 'flakinessScore';

const MOCK_DATA: LeaderboardEntry[] = [
  {
    testId: 't1',
    testName: 'should render login form',
    suiteName: 'Auth',
    failureCount: 42,
    avgDurationMs: 1200,
    flakinessScore: 0.8,
  },
  {
    testId: 't2',
    testName: 'should submit payment',
    suiteName: 'Checkout',
    failureCount: 31,
    avgDurationMs: 4500,
    flakinessScore: 0.6,
  },
  {
    testId: 't3',
    testName: 'should load dashboard',
    suiteName: 'Dashboard',
    failureCount: 18,
    avgDurationMs: 8200,
    flakinessScore: 0.3,
  },
  {
    testId: 't4',
    testName: 'should export CSV',
    suiteName: 'Reports',
    failureCount: 9,
    avgDurationMs: 12000,
    flakinessScore: 0.15,
  },
  {
    testId: 't5',
    testName: 'should send notification',
    suiteName: 'Notifications',
    failureCount: 5,
    avgDurationMs: 3100,
    flakinessScore: 0.55,
  },
];

function FlakinessBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  if (score >= 0.7) return <Badge variant="danger">{pct}%</Badge>;
  if (score >= 0.4) return <Badge variant="warning">{pct}%</Badge>;
  return <Badge variant="secondary">{pct}%</Badge>;
}

export function LeaderboardsPage({
  entries = MOCK_DATA,
}: {
  entries?: LeaderboardEntry[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>('failureCount');

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b[sortKey] - a[sortKey]),
    [entries, sortKey],
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        data-testid="leaderboards-empty"
        title="No Data"
        description="No test data available for leaderboards."
      />
    );
  }

  return (
    <div data-testid="leaderboards-page" className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-text-primary">Test Leaderboards</h2>
        <div className="flex gap-2" data-testid="sort-controls">
          <Button
            variant={sortKey === 'failureCount' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSortKey('failureCount')}
            data-testid="sort-failures"
          >
            Most Failing
          </Button>
          <Button
            variant={sortKey === 'avgDurationMs' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSortKey('avgDurationMs')}
            data-testid="sort-slowest"
          >
            Slowest
          </Button>
          <Button
            variant={sortKey === 'flakinessScore' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSortKey('flakinessScore')}
            data-testid="sort-flaky"
          >
            Most Flaky
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Test Name</TableHead>
            <TableHead>Suite</TableHead>
            <TableHead>Failures</TableHead>
            <TableHead>Avg Duration</TableHead>
            <TableHead>Flakiness</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((entry, idx) => (
            <TableRow key={entry.testId} data-testid={`leaderboard-row-${entry.testId}`}>
              <TableCell className="text-text-secondary font-mono">{idx + 1}</TableCell>
              <TableCell className="font-medium">{entry.testName}</TableCell>
              <TableCell className="text-text-secondary">{entry.suiteName}</TableCell>
              <TableCell>
                <Badge variant={entry.failureCount > 20 ? 'danger' : 'warning'}>
                  {entry.failureCount}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-sm">
                {entry.avgDurationMs >= 1000
                  ? `${(entry.avgDurationMs / 1000).toFixed(1)}s`
                  : `${entry.avgDurationMs}ms`}
              </TableCell>
              <TableCell>
                <FlakinessBadge score={entry.flakinessScore} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
