import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { type TestWithResults, type ResultParsed, type Attachment } from '@/lib/types';
import { RetryTabs } from './RetryTabs';
import { StepTree } from './StepTree';
import { StepTimeline } from './StepTimeline';
import { ScreenshotDiff } from '@/components/artifacts/ScreenshotDiff';
import { VideoPlayer } from '@/components/artifacts/VideoPlayer';
import { TestHistoryTimeline } from './TestHistoryTimeline';
import { TraceViewer } from '@/components/artifacts/TraceViewer';
import { CrossProductLink } from '@/components/CrossProductLink';
import { formatDuration, shortPath } from '@/lib/formatters';
import { fadeSlideUp } from '@/lib/motion';
import { AlertTriangle, Link2, Clock, Copy, Check, ChevronDown, ExternalLink, Wand2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { FeatureGate } from '@/components/FeatureGate';
import { AiExplainButton } from './AiExplainButton';
import { CodePeek } from './CodePeek';
import { cn } from '@/lib/utils';


// Capture clipboard reference at module load time so that test spies set before
// userEvent.setup() (which replaces navigator.clipboard with a stub) are still
// reachable via this stable reference.
const _clipboardRef = typeof navigator !== 'undefined' ? navigator.clipboard : null;

const TABS = [
  'Error',
  'Timeline',
  'Steps',
  'Screenshots',
  'Video',
  'Trace',
  'History',
  'Console',
  'Source',
] as const;

type Tab = (typeof TABS)[number];


interface LocatorSuggestion {
  id: string;
  testId: string;
  runId: string;
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
}

interface HistoryRow {
  id: string;
  runId: string;
  status: string;
  durationMs: number | null;
  retryCount: number | null;
  runStartedAt: string;
  runBranch: string | null;
  runCommitSha: string | null;
}
interface TestDetailProps {
  test: TestWithResults;
  runId?: string;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}

export function TestDetail({ test, runId, initialTab, onTabChange }: TestDetailProps) {
  const [retryIdx, setRetryIdx] = useState<number>(
    Math.max(0, (test.results?.length ?? 1) - 1),
  );
  const resolvedInitialTab = TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'Error';
  const [tab, setTabLocal] = useState<Tab>(resolvedInitialTab);

  const setTab = (t: Tab) => {
    setTabLocal(t);
    onTabChange?.(t);
  };

  const result: ResultParsed | undefined = test.results?.[retryIdx];
  const screenshots = result?.attachments?.filter((a) => a.contentType.startsWith('image/')) ?? [];
  const videos = result?.attachments?.filter((a) => a.contentType.startsWith('video/')) ?? [];
  const traces = result?.attachments?.filter((a) => a.name === 'trace') ?? [];

  // History tab data — only fetched when stableId is known
  const { data: historyRows, isLoading: historyLoading } = useQuery<HistoryRow[]>({
    queryKey: ['test-history', test.stableId],
    queryFn: async () => {
      const res = await fetch(`/api/tests/history/${test.stableId}`);
      if (!res.ok) throw new Error('Failed to fetch test history');
      return res.json() as Promise<HistoryRow[]>;
    },
    enabled: tab === 'History' && !!test.stableId,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface">
      {/* Header */}
      <div className="px-4 pt-4 pb-0 border-b border-border-subtle">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-semibold truncate flex-1 min-w-0 text-text-primary">
            {test.title}
          </h3>
          {runId && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}/runs/${runId}?testId=${test.id}&tab=${tab}`
                );
                toast.success('Test link copied');
              }}
              className="shrink-0 ml-2 p-1 rounded transition-colors hover:opacity-80 text-text-tertiary"
              title="Copy test permalink"
              aria-label="Copy test permalink"
            >
              <Link2 size={13} />
            </button>
          )}
        </div>
        <p className="text-xs mb-2 text-text-tertiary">
          {shortPath(test.file)}:{test.line} &middot; {formatDuration(test.durationMs ?? 0)}
        </p>

        {/* Retry tabs */}
        {test.results && test.results.length > 1 && (
          <RetryTabs
            results={test.results}
            activeIndex={retryIdx}
            onChange={setRetryIdx}
          />
        )}

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 mt-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'shrink-0 px-3 py-1.5 text-xs transition-colors rounded-t-md border-b-2',
                tab === t
                  ? 'text-text-primary border-b-border-focus bg-bg-elevated'
                  : 'text-text-tertiary border-b-transparent bg-transparent',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab + retryIdx}
            variants={fadeSlideUp}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="h-full"
          >
            {tab === 'History' && (
              !test.stableId ? (
                <EmptyTab label="No history — run recorded before history tracking was enabled" icon={<Clock size={20} />} />
              ) : historyLoading ? (
                <div className="p-4 flex flex-col gap-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-8 rounded animate-pulse bg-bg-elevated" />
                  ))}
                </div>
              ) : !historyRows?.length ? (
                <EmptyTab label="No history yet for this test" icon={<Clock size={20} />} />
              ) : (
                <TestHistoryTimeline rows={historyRows} />
              )
            )}

            {tab === 'Timeline' && result && (
              <StepTimeline
                steps={result.steps ?? []}
                totalDurationMs={result.durationMs ?? 1}
              />
            )}

            {tab === 'Steps' && result && (
              <div className="p-2">
                <StepTree steps={result.steps ?? []} />
              </div>
            )}

            {tab === 'Error' && (
              result?.error ? (
                <div className="p-4">
                  <ErrorDisplay error={result.error} testTitle={test.title} testFile={test.file} />
                  <FeatureGate flag="ai-explain">
                    <AiExplainButton error={result.error.message} stack={result.error.stack} testCode={undefined} />
                  </FeatureGate>
                  <FeatureGate flag="locator-intelligence">
                    {runId && (
                      <LocatorSuggestionBanner testId={test.id} runId={runId} />
                    )}
                  </FeatureGate>
                </div>
              ) : (
                <EmptyTab label="No error" />
              )
            )}

            {tab === 'Screenshots' && (
              screenshots.length ? (
                <div className="p-4 flex flex-col gap-4">
                  {screenshots.map((att, i) => (
                    att.path?.includes('expected') || att.path?.includes('diff') || att.path?.includes('actual')
                      ? <ScreenshotDiff key={i} attachment={att} />
                      : (
                        <div key={i} className="rounded-lg overflow-hidden border border-border-subtle">
                          <img
                            src={`/artifacts/${att.path}`}
                            alt={att.name}
                            className="w-full object-contain"
                          />
                          <div className="px-2 py-1 text-xs flex items-center gap-2 text-text-tertiary">
                            {att.name}
                            {((att as Attachment & { autoCapture?: boolean }).autoCapture || att.name === 'screenshot') && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] leading-none font-medium border text-text-tertiary border-border-subtle bg-bg-elevated"
                              >
                                Auto-captured
                              </span>
                            )}
                        </div>
                        </div>
                      )
                  ))}
                </div>
              ) : (
                <EmptyTab
                  label="No screenshots captured."
                  hint={"Enable in playwright.config.ts:\nuse: { screenshot: 'only-on-failure' }"}
                  docsUrl="https://playwright.dev/docs/test-use-options#recording-options"
                />
              )
            )}

            {tab === 'Video' && (
              videos.length ? (
                <div className="p-4 flex flex-col gap-4">
                  {videos.map((v, i) => (
                    <VideoPlayer key={i} path={v.path!} steps={result?.steps ?? []} totalDurationMs={result?.durationMs ?? 1} />
                  ))}
                </div>
              ) : (
                <EmptyTab
                  label="No video recorded."
                  hint={"Enable in playwright.config.ts:\nuse: { video: 'on-first-retry' }"}
                  docsUrl="https://playwright.dev/docs/test-use-options#recording-options"
                />
              )
            )}

            {tab === 'Trace' && (
              traces.length ? (
                <div className="p-4 flex flex-col gap-4">
                  {traces.map((t, i) => (
                    <TraceViewer key={i} tracePath={t.path!} />
                  ))}
                </div>
              ) : (
                <EmptyTab
                  label="No trace recorded."
                  hint={"Enable in playwright.config.ts:\nuse: { trace: 'on-first-retry' }"}
                  docsUrl="https://playwright.dev/docs/test-use-options#recording-options"
                />
              )
            )}

            {tab === 'Console' && (
              result?.stdout || result?.stderr ? (
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-text-secondary">
                  {result.stdout}{result.stderr}
                </pre>
              ) : (
                <EmptyTab label="No console output" />
              )
            )}


            {tab === 'Source' && (
              test.file ? (
                <CodePeek file={test.file} line={test.line} />
              ) : (
                <EmptyTab label="No source" />
              )
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyTab({
  label,
  icon,
  hint,
  docsUrl,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  docsUrl?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 h-full py-16 text-text-tertiary">
      {icon}
      <p className="text-xs">{label}</p>
      {hint && (
        <code className="text-[11px] text-center px-3 py-2 rounded-md bg-bg-elevated border border-border-subtle font-mono whitespace-pre">
          {hint}
        </code>
      )}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-[var(--color-text-link)] hover:underline flex items-center gap-1"
        >
          Playwright docs <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
function ErrorDisplay({ error, testTitle, testFile }: { error: ResultParsed['error']; testTitle: string; testFile: string }) {
  const [isCopied, setIsCopied] = useState(false);
  const stackLines = error?.stack?.split('\n') ?? [];
  const [isStackVisible, setIsStackVisible] = useState(stackLines.length <= 5);

  const handleCopy = () => {
    if (!error) return;
    const textToCopy = `${error.message}\n${error.stack ?? ''}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  if (!error) return null;

  const askAiContext = `Analyze this test failure:\n\nTest: ${testTitle}\nFile: ${testFile}\nError: ${error.message}`;

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded-lg border text-xs break-all"
      style={{
        background: 'color-mix(in oklch, var(--color-fail) 10%, transparent)',
        borderColor: 'color-mix(in oklch, var(--color-fail) 30%, transparent)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-fail" />
        <div className="flex-1 font-semibold">{error.message}</div>
        <div className="flex items-center gap-1.5">
          <CrossProductLink
            targetApp="ai"
            path="/chat"
            context={askAiContext}
            label="Ask AI"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--color-text-link)] hover:underline"
          />
          <button onClick={handleCopy} className="p-1 rounded hover:bg-white/10 transition-colors">
            {isCopied ? <Check size={14} className="text-pass" /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      {error.stack && (
        <>
          <button
            onClick={() => setIsStackVisible(!isStackVisible)}
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors self-start"
          >
            {isStackVisible ? 'Hide' : 'Show'} stack trace
            <ChevronDown size={12} className={cn('transition-transform', isStackVisible && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {isStackVisible && (
              <motion.div
                initial="collapsed"
                animate="open"
                exit="collapsed"
                variants={{
                  open: { opacity: 1, height: 'auto' },
                  collapsed: { opacity: 0, height: 0 },
                }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-secondary pt-2">
                  {error.stack}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function LocatorSuggestionBanner({ testId, runId }: { testId: string; runId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: suggestions = [] } = useQuery<LocatorSuggestion[]>({
    queryKey: ['locator-suggestions', testId, runId],
    queryFn: async () => {
      const res = await fetch(
        `/api/locator-suggestions?testId=${encodeURIComponent(testId)}&runId=${encodeURIComponent(runId)}`,
      );
      if (!res.ok) throw new Error('Failed to fetch locator suggestions');
      return res.json() as Promise<LocatorSuggestion[]>;
    },
    staleTime: 60_000,
  });

  const pending = suggestions.filter((s) => s.status === 'pending');

  const accept = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/locator-suggestions/${id}/accept`, { method: 'PUT' });
      if (!res.ok) throw new Error('Failed to accept suggestion');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['locator-suggestions', testId, runId] });
      toast.success('Selector accepted');
    },
    onError: () => toast.error('Failed to accept suggestion'),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/locator-suggestions/${id}/reject`, { method: 'PUT' });
      if (!res.ok) throw new Error('Failed to reject suggestion');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['locator-suggestions', testId, runId] });
      toast.success('Selector dismissed');
    },
    onError: () => toast.error('Failed to dismiss suggestion'),
  });

  const handleCopy = (id: string, selector: string) => {
    const cb = _clipboardRef ?? navigator.clipboard;
    void cb.writeText(selector).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (pending.length === 0) return null;

  return (
    <div
      className="mt-3 rounded-lg border text-xs overflow-hidden"
      style={{
        borderColor: 'color-mix(in oklch, var(--color-info, #3b82f6) 30%, transparent)',
        background: 'color-mix(in oklch, var(--color-info, #3b82f6) 8%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80 transition-opacity"
        aria-expanded={expanded}
        aria-label="Toggle selector fix suggestions"
      >
        <Wand2 size={13} className="shrink-0" style={{ color: 'var(--color-info, #3b82f6)' }} />
        <span className="flex-1 font-medium" style={{ color: 'var(--color-info, #3b82f6)' }}>
          Selector fix available ({pending.length})
        </span>
        <ChevronDown
          size={12}
          className={cn('transition-transform', expanded && 'rotate-180')}
          style={{ color: 'var(--color-info, #3b82f6)' }}
        />
      </button>

      {expanded && (
        <div className="overflow-hidden">
            <div className="px-3 pb-3 flex flex-col gap-2">
              {pending.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md p-2 flex flex-col gap-1.5 bg-bg-elevated border border-border-subtle"
                  data-testid="locator-suggestion-item"
                >
                  <div className="flex items-start gap-1.5">
                    <span className="text-text-tertiary shrink-0 mt-0.5">Before:</span>
                    <code className="font-mono text-[11px] break-all text-text-secondary">
                      {s.originalSelector}
                    </code>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-text-tertiary shrink-0 mt-0.5">After:</span>
                    <code className="font-mono text-[11px] break-all text-pass flex-1">
                      {s.suggestedSelector}
                    </code>
                  </div>
                  <div className="text-[11px] text-text-tertiary">
                    Confidence: {Math.round(s.confidence * 100)}% &middot; <span>{s.rationale}</span>
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleCopy(s.id, s.suggestedSelector)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-bg-surface border border-border-subtle hover:opacity-80 transition-opacity"
                      aria-label="Copy suggested selector"
                    >
                      {copiedId === s.id ? (
                        <Check size={11} className="text-pass" />
                      ) : (
                        <Copy size={11} />
                      )}
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => accept.mutate(s.id)}
                      disabled={accept.isPending}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-bg-surface border border-border-subtle hover:opacity-80 transition-opacity disabled:opacity-50"
                      aria-label="Accept selector suggestion"
                    >
                      <ThumbsUp size={11} className="text-pass" />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => reject.mutate(s.id)}
                      disabled={reject.isPending}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-bg-surface border border-border-subtle hover:opacity-80 transition-opacity disabled:opacity-50"
                      aria-label="Reject selector suggestion"
                    >
                      <ThumbsDown size={11} />
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
        </div>
      )}
    </div>
  );
}
