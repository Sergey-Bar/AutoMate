import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore } from '@/store/onboardingStore';
import { useWsStore } from '@/store/wsStore';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Check, Copy, X } from 'lucide-react';

const COMMANDS = [
  { label: 'Install reporter package', value: 'npm install -D @automate/reporter' },
  { label: 'Add reporter in playwright.config.ts', value: "reporter: [['list'], ['@automate/reporter']]" },
  { label: 'Run tests with Automate URL', value: 'AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test' },
] as const;

const isRunStart = (event: unknown) => {
  if (!event || typeof event !== 'object') return false;
  const record = event as { type?: string; topic?: string };
  return record.type === 'run:start' || record.topic === 'run:start';
};

export function OnboardingWizard() {
  const { hasCompletedOnboarding, setCompleted } = useOnboardingStore();
  const subscribe = useWsStore((state) => state.subscribe);
  const [step, setStep] = useState<0 | 1>(0);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribe('*', (event) => {
      if (isRunStart(event)) setCompleted();
    });
    return unsubscribe;
  }, [setCompleted, subscribe]);

  const copy = async (index: number, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(index);
    setTimeout(() => setCopied((current) => (current === index ? null : current)), 1000);
  };

  if (hasCompletedOnboarding) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 flex items-center justify-center pointer-events-none"
        style={{ background: 'oklch(0 0 0 / 0.6)', backdropFilter: 'blur(4px)' }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring.smooth}
          className="w-130 rounded-2xl border border-border-default bg-bg-elevated shadow-2xl overflow-hidden pointer-events-auto"
        >
          <div className="px-6 pt-6 pb-4 relative">
            <h2 className="text-lg font-semibold text-text-primary">
              Welcome to Automate
            </h2>
            <p className="text-sm mt-1 text-text-secondary">
              Here's how to connect your tests:
            </p>
            <button
              type="button"
              onClick={() => setCompleted()}
              className="absolute top-4 right-4 p-1 rounded text-text-tertiary hover:bg-white/10 transition-colors"
              aria-label="Close wizard"
            >
              <X size={16} />
            </button>
          </div>
          <div className="px-6 pb-6 min-h-45">
            {step === 0 ? (
              <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={spring.smooth} className="space-y-3">
                {COMMANDS.map((item, index) => {
                  const isCopied = copied === index;
                  return (
                    <div key={item.label} className="p-3 rounded-lg border border-border-default bg-bg-surface">
                      <p className="text-xs text-text-secondary mb-2">{index + 1}. {item.label}</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs text-text-primary break-all">{item.value}</code>
                        <button
                          type="button"
                          onClick={() => void copy(index, item.value)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                            isCopied ? 'border-pass text-pass' : 'border-border-default text-text-secondary hover:text-text-primary'
                          )}
                          aria-label={`Copy command ${index + 1}`}
                        >
                          {isCopied ? <Check size={12} /> : <Copy size={12} />}
                          {isCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={spring.smooth} className="flex flex-col items-center justify-center text-center gap-3 py-8">
                <div className="flex items-center gap-2 text-text-primary">
                  <span className="h-2 w-2 rounded-full bg-running animate-pulse" />
                  <p className="text-sm font-medium">Waiting for first test run...</p>
                </div>
                <p className="text-xs text-text-tertiary">Run Playwright from your test machine to continue automatically.</p>
              </motion.div>
            )}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle">
            {step === 1 ? (
              <button type="button" onClick={() => setCompleted()} className="text-xs text-text-tertiary hover:text-text-secondary">
                Skip
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={() => setStep(1)}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium bg-running text-white', step === 1 && 'invisible')}
            >
              Next
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
