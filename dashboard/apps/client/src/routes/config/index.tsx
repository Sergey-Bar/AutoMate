import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { ProjectMatrix } from '@/components/config/ProjectMatrix';
import { usePlaywrightConfig } from '@/hooks/usePlaywrightConfig';
import { Settings2, Code2, Eye, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/config/')({
  component: ConfigPage,
});

function ConfigPage() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const [tab, setTab] = useState<'visual' | 'editor'>('visual');

  return (
    <ErrorBoundary label={tr('configPage.errorBoundaryLabel', 'Config')}>
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 size={18} className="text-text-tertiary" />
            <h1 className="text-xl font-semibold text-text-primary">
              {tr('configPage.title', 'Playwright Config')}
            </h1>
          </div>

          {/* Tab toggle */}
          <div
            className="flex items-center gap-1 rounded-lg border border-border-subtle p-0.5"
          >
            <TabButton
              active={tab === 'visual'}
              onClick={() => setTab('visual')}
              icon={<Eye size={13} />}
              label={tr('configPage.visual', 'Visual')}
            />
            <TabButton
              active={tab === 'editor'}
              onClick={() => setTab('editor')}
              icon={<Code2 size={13} />}
              label={tr('configPage.editor', 'Editor')}
            />
          </div>
        </div>

        {/* Content */}
        {tab === 'visual' ? <ProjectMatrix /> : <ConfigEditor />}
      </div>
    </ErrorBoundary>
  );
}

/* ─── Tab button ──────────────────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-running text-white' : 'bg-transparent text-text-secondary'
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

/* ─── Raw config editor ──────────────────────────────────────────────── */

function ConfigEditor() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const { config, isLoading, error, save, isSaving } = usePlaywrightConfig();
  const [draft, setDraft] = useState<string | null>(null);

  // Initialize draft from loaded config
  const content = draft ?? config?.content ?? '';
  const isDirty = draft !== null && draft !== config?.content;

  if (isLoading) {
    return (
      <div
        className="h-96 rounded-xl border border-border-subtle bg-bg-elevated animate-pulse"
      />
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 py-12 text-text-secondary"
      >
        <p className="text-sm">{tr('configPage.couldNotLoad', 'Could not load playwright config.')}</p>
        <p className="text-xs text-text-tertiary">
          {error instanceof Error ? error.message : tr('configPage.unknownError', 'Unknown error')}
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border-default bg-bg-surface overflow-hidden"
    >
      {/* Editor toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-border-subtle"
      >
        <span className="text-xs font-mono text-text-tertiary">
          {config?.path ?? 'playwright.config.ts'}
        </span>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[11px] text-flaky">
              {tr('configPage.unsavedChanges', 'Unsaved changes')}
            </span>
          )}
          <button
            type="button"
            onClick={() => save(content)}
            disabled={!isDirty || isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 transition-opacity bg-running text-white"
          >
            <Save size={12} />
            {isSaving
              ? tr('configPage.saving', 'Saving…')
              : tr('common.save', 'Save')}
          </button>
        </div>
      </div>

      {/* Textarea editor */}
      <textarea
        value={content}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full min-h-125 p-4 font-mono text-sm text-text-primary bg-transparent outline-none resize-y"
        spellCheck={false}
      />
    </div>
  );
}
