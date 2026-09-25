import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingStore {
  hasCompletedOnboarding: boolean;
  setCompleted: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      setCompleted: () => set({ hasCompletedOnboarding: true }),
      reset: () => set({ hasCompletedOnboarding: false }),
    }),
    { name: 'mc-onboarding' },
  ),
);
