import { createLazyFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Wand2, Copy, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { cn } from '@/lib/utils';

export const Route = createLazyFileRoute('/tools/test-generator')({
  component: TestGeneratorPage,
});

interface GenerateResult {
  code: string;
  filename: string;
  confidence: number;
  warnings: string[];
}

interface SaveResult {
  saved: boolean;
  path: string;
}

function TestGeneratorPage() {
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/test-generation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Failed to generate test');
      }
      return res.json() as Promise<GenerateResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setSavedPath(null);
      setCopied(false);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('No generated code to save');
      const res = await fetch('/api/test-generation/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: result.code,
          filePath: result.filename,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Failed to save file');
      }
      return res.json() as Promise<SaveResult>;
    },
    onSuccess: (data) => {
      setSavedPath(data.path);
    },
  });

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const confidencePct = result ? Math.round(result.confidence * 100) : null;
  const confidenceColor =
    result && result.confidence >= 0.8
      ? 'text-pass'
      : result && result.confidence >= 0.5
        ? 'text-flaky'
        : 'text-fail';

  return (
    <FeatureGate flag="test-generation" fallback={<FeatureDisabledPage feature="Test Generator" />}>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border-subtle bg-bg-surface shrink-0">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-running" />
            <h1 className="text-sm font-semibold text-text-primary">Test Generator</h1>
          </div>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Describe a test scenario in plain English — get a complete Playwright test file.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left: Inputs */}
          <div className="w-full md:w-80 shrink-0 border-r border-border-subtle bg-bg-surface p-4 space-y-4 overflow-y-auto">
            {/* Description */}
            <div>
              <label
                htmlFor="test-description"
                className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5 text-text-tertiary"
              >
                Test Description <span className="text-fail">*</span>
              </label>
              <textarea
                id="test-description"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. log in as admin, verify the dashboard loads, click Runs, assert the table is visible"
                className={cn(
                  'w-full px-2.5 py-2 rounded-lg text-xs border border-border-subtle',
                  'bg-bg-elevated text-text-primary placeholder:text-text-tertiary',
                  'resize-none focus:outline-none focus:border-border-focus',
                )}
              />
            </div>

            {/* Base URL */}
            <div>
              <label
                htmlFor="test-base-url"
                className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5 text-text-tertiary"
              >
                Base URL <span className="text-text-tertiary font-normal">(optional)</span>
              </label>
              <input
                id="test-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://my-app.example.com"
                className={cn(
                  'w-full px-2.5 py-1.5 rounded-lg text-xs border border-border-subtle',
                  'bg-bg-elevated text-text-primary placeholder:text-text-tertiary',
                  'focus:outline-none focus:border-border-focus',
                )}
              />
            </div>

            {/* Generate button */}
            <Button
              variant="primary"
              size="md"
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              disabled={!description.trim() || generateMutation.isPending}
              icon={<Wand2 size={13} />}
              className="w-full"
            >
              Generate Test
            </Button>

            {/* Error */}
            {generateMutation.isError && (
              <div
                className="text-xs px-2.5 py-2 rounded-lg border border-fail/30 bg-fail/5 text-fail"
                role="alert"
              >
                {(generateMutation.error as Error).message}
              </div>
            )}
          </div>

          {/* Right: Output */}
          <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
            {result ? (
              <>
                {/* Confidence + actions bar */}
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-semibold', confidenceColor)}>
                      {confidencePct}% confidence
                    </span>
                    <span className="text-xs text-text-tertiary">{result.filename}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCopy}
                      icon={copied ? <CheckCircle2 size={13} className="text-pass" /> : <Copy size={13} />}
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => saveMutation.mutate()}
                      loading={saveMutation.isPending}
                      icon={<Save size={13} />}
                    >
                      Save to file
                    </Button>
                  </div>
                </div>

                {/* Warnings */}
                {result.warnings.length > 0 && (
                  <div className="shrink-0 space-y-1.5">
                    {result.warnings.map((w) => (
                      <div
                        key={w}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-flaky/30 bg-flaky/5 text-xs text-flaky"
                        role="alert"
                      >
                        <AlertTriangle size={13} className="shrink-0" />
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Save success */}
                {savedPath && (
                  <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-pass/30 bg-pass/5 text-xs text-pass">
                    <CheckCircle2 size={13} className="shrink-0" />
                    Saved to: <span className="font-mono">{savedPath}</span>
                  </div>
                )}

                {/* Code block */}
                <pre className="flex-1 overflow-auto rounded-lg border border-border-subtle bg-bg-elevated p-4 text-xs font-mono text-text-primary leading-relaxed">
                  <code>{result.code}</code>
                </pre>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center px-4">
                <div>
                  <Wand2 size={32} className="mx-auto mb-3 text-text-tertiary opacity-40" />
                  <p className="text-sm font-medium text-text-secondary">
                    Enter a description and click Generate
                  </p>
                  <p className="mt-1 text-xs text-text-tertiary max-w-xs">
                    Describe your test scenario in plain English — the AI will generate a complete Playwright TypeScript test.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}
