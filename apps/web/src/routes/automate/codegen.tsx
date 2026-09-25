import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import { Stack } from '@automate/ui';
import { CodegenPanel } from '../../components/automate/CodegenPanel.js';
import { RecorderBridge } from '../../components/automate/RecorderBridge.js';
import type { RecorderStatus } from '../../components/automate/RecorderBridge.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: 'codegen',
  component: () => <CodegenPage />,
});

const PLACEHOLDER_CODE = `import { test, expect } from '@playwright/test';

test('recorded test', async ({ page }) => {
  // Start recording to generate test steps
});
`;

export function CodegenPage() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [code, setCode] = useState(PLACEHOLDER_CODE);

  const handleStart = (url: string) => {
    setStatus('recording');
    setCode(`import { test, expect } from '@playwright/test';

test('recorded test', async ({ page }) => {
  await page.goto('${url}');
  // Recording in progress...
});
`);
  };

  const handleStop = () => {
    setStatus('idle');
  };

  const handlePause = () => {
    setStatus('paused');
  };

  return (
    <div data-testid="codegen-page" className="p-6">
      <Stack gap={6}>
        <div>
          <h1 className="text-2xl font-bold">Codegen</h1>
          <p className="text-sm text-fg-muted mt-1">Record browser interactions and generate Playwright test code</p>
        </div>
        <RecorderBridge
          status={status}
          onStart={handleStart}
          onStop={handleStop}
          onPause={handlePause}
        />
        <CodegenPanel code={code} language="typescript" />
      </Stack>
    </div>
  );
}
