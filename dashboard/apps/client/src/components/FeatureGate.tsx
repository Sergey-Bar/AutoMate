import type { ReactNode } from 'react';
import { useFeature, useFeatureStore } from '@/store/featureStore';

interface FeatureGateProps {
  flag: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  const enabled = useFeature(flag);
  const loaded = useFeatureStore((s) => s.loaded);
  // Permissive until flags are loaded — don't flash "disabled" while loading
  return (!loaded || enabled) ? <>{children}</> : <>{fallback}</>;
}
