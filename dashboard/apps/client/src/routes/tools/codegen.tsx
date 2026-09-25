import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Square, Globe, Code2 } from 'lucide-react';
import { CodegenPanel } from '@/components/tools/CodegenPanel';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/tools/codegen')({
  component: CodegenPage,
});

type Browser = 'chromium' | 'firefox' | 'webkit';
type Language = 'typescript' | 'javascript' | 'python' | 'csharp' | 'java';

function CodegenPage() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const qc = useQueryClient();
  const [url, setUrl] = useState('http://localhost:3000');
  const [browser, setBrowser] = useState<Browser>('chromium');
  const [language, setLanguage] = useState<Language>('typescript');

  const { data: status } = useQuery<{ running: boolean; pid: number | null }>({
    queryKey: ['codegen-status'],
    queryFn: () => fetch('/api/codegen/status').then((r) => r.json()),
    refetchInterval: 3000,
  });

  const isRunning = status?.running ?? false;

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/codegen/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, browser, language }),
      });
      if (!res.ok) throw new Error(tr('codegenPage.failedToStart', 'Failed to start codegen'));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['codegen-status'] });
      toast.success(tr('codegenPage.started', 'Codegen started — browser window will open'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/codegen/stop', { method: 'POST' });
      if (!res.ok) throw new Error(tr('codegenPage.failedToStop', 'Failed to stop'));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['codegen-status'] });
      toast.success(tr('codegenPage.stopped', 'Codegen stopped'));
    },
    onError: () => toast.error(tr('codegenPage.failedToStopCodegen', 'Failed to stop codegen')),
  });

  return (
    <FeatureGate flag="codegen-launcher" fallback={<FeatureDisabledPage feature="Codegen" />}>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-3 border-b border-border-subtle bg-bg-surface shrink-0"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 size={16} className="text-running" />
            <h1 className="text-sm font-semibold text-text-primary">
              {tr('codegenPage.title', 'Codegen')}
            </h1>
            {isRunning && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded animate-pulse bg-pass-bg text-pass"
              >
                ● {tr('codegenPage.recording', 'Recording')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Controls + Panel */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: Controls */}
        <div
          className="w-full md:w-72 shrink-0 border-r md:border-r border-b md:border-b-0 border-border-subtle bg-bg-surface p-4 space-y-4 overflow-y-auto"
        >
          {/* URL */}
          <div>
            <label htmlFor="codegen-target-url" className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5 text-text-tertiary">
              {tr('codegenPage.targetUrl', 'Target URL')}
            </label>
            <div className="flex items-center gap-1.5">
              <Globe size={13} className="text-text-tertiary" />
              <input
                id="codegen-target-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isRunning}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-border-subtle bg-bg-elevated text-text-primary font-mono disabled:opacity-60"
                placeholder={tr('codegenPage.placeholderUrl', 'http://localhost:3000')}
              />
            </div>
          </div>

          {/* Browser */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5 text-text-tertiary">
              {tr('codegenPage.browser', 'Browser')}
            </p>
            <div className="flex gap-1">
              {(['chromium', 'firefox', 'webkit'] as Browser[]).map((b) => (
                <button
                  type="button"
                  key={b}
                  onClick={() => setBrowser(b)}
                  disabled={isRunning}
                  className={cn(
                    'flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize disabled:opacity-60',
                    browser === b ? 'bg-running text-white' : 'bg-bg-elevated text-text-secondary',
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label htmlFor="codegen-language" className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5 text-text-tertiary">
              {tr('codegenPage.language', 'Language')}
            </label>
            <select
              id="codegen-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              disabled={isRunning}
              className="w-full px-2 py-1.5 rounded-lg text-xs border border-border-subtle bg-bg-elevated text-text-primary disabled:opacity-60"
            >
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="csharp">C#</option>
              <option value="java">Java</option>
            </select>
          </div>

          {/* Start / Stop */}
          <div className="pt-2">
            {isRunning ? (
            <Button
                variant="danger"
                size="md"
                onClick={() => stopMutation.mutate()}
                loading={stopMutation.isPending}
                icon={<Square size={13} />}
                className="w-full"
              >
                {tr('codegenPage.stopRecording', 'Stop Recording')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => startMutation.mutate()}
                loading={startMutation.isPending}
                icon={<Play size={13} />}
                className="w-full bg-pass"
              >
                {tr('codegenPage.startRecording', 'Start Recording')}
              </Button>
            )}
          </div>

          {/* Help text */}
          <div
            className="text-[11px] leading-relaxed text-text-tertiary"
          >
            <p className="font-medium mb-1 text-text-secondary">{tr('codegenPage.howItWorks', 'How it works:')}</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>{tr('codegenPage.step1', 'Click "Start Recording"')}</li>
              <li>{tr('codegenPage.step2', 'A browser window opens automatically')}</li>
              <li>{tr('codegenPage.step3', 'Interact with your app — clicks, fills, navigations')}</li>
              <li>{tr('codegenPage.step4', 'Generated code appears in the panel')}</li>
              <li>{tr('codegenPage.step5', 'Click "Save" to write the test file to disk')}</li>
            </ol>
          </div>
        </div>

        {/* Right: Code Panel */}
        <div className="flex-1 p-4 overflow-hidden">
          <CodegenPanel isRunning={isRunning} />
      </div>
    </div>
    </div>
    </FeatureGate>
  );
}
