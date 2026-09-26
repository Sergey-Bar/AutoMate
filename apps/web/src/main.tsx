import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import * as Sentry from '@sentry/react';
import { Alert, AlertDescription, AlertTitle, Button, Container, Stack } from '@automate/ui';
import { router } from './router.js';
import { buildBrowserSentryOptions } from './observability/sentry.js';
import './index.css';

const sentryOptions = buildBrowserSentryOptions(router, {
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: import.meta.env.VITE_SENTRY_RELEASE,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
});
if (sentryOptions) {
  Sentry.init(sentryOptions);
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ eventId, resetError }) => (
        <Container className="py-12">
          <Stack gap={4}>
            <Alert variant="danger">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>
                <p>
                  The dashboard failed to render. The error has been reported with reference
                  {eventId ? ` ${eventId}` : ''}.
                </p>
              </AlertDescription>
            </Alert>
            <div>
              {/* `resetError` rather than a reload: the boundary is only for a render
                  failure, and the data behind it is still in memory. */}
              <Button onClick={resetError}>Try again</Button>
            </div>
          </Stack>
        </Container>
      )}
    >
      <RouterProvider router={router} />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
