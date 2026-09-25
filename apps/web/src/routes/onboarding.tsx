import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingComponent,
});

function OnboardingComponent() {
  return (
    <div data-testid="onboarding-page">
      <h1>Onboarding</h1>
    </div>
  );
}
