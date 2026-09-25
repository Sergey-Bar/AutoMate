/// <reference types="vitest" />
import { describe, it, expect, beforeEach } from 'vitest';
import { useOnboardingStore } from './onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ hasCompletedOnboarding: false });
  });

  describe('initial state', () => {
    it('defaults to false', () => {
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
    });
  });

  describe('setCompleted', () => {
    it('sets hasCompletedOnboarding to true', () => {
      useOnboardingStore.getState().setCompleted();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
    });

    it('remains true after multiple calls', () => {
      useOnboardingStore.getState().setCompleted();
      useOnboardingStore.getState().setCompleted();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
    });
  });

  describe('reset', () => {
    it('resets hasCompletedOnboarding to false', () => {
      useOnboardingStore.getState().setCompleted();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(true);
      useOnboardingStore.getState().reset();
      expect(useOnboardingStore.getState().hasCompletedOnboarding).toBe(false);
    });
  });
});
