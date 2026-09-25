import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import { NLTestGenerator } from '../../components/automate/NLTestGenerator.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: 'ai-authoring',
  component: () => <AIAuthoringPage />,
});

export function AIAuthoringPage() {
  return (
    <div data-testid="ai-authoring-page" className="p-6">
      <div style={{ marginBottom: 24 }}>
        <h1 className="text-2xl font-bold">AI Test Authoring</h1>
        <p className="text-sm text-fg-muted mt-1">
          Describe a test scenario in plain English and let AI generate a Playwright test for you.
        </p>
      </div>
      <NLTestGenerator />
    </div>
  );
}

export default AIAuthoringPage;
