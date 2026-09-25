import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SettingsNav, type SettingsTab } from '@/components/settings/SettingsNav';
import { GeneralSettings } from '@/components/settings/GeneralSettings';
import { AuthSettings } from '@/components/settings/AuthSettings';
import { DataRetentionSettings } from '@/components/settings/DataRetentionSettings';
import { BackupRestoreSettings } from '@/components/settings/BackupRestoreSettings';
import { DisplaySettings } from '@/components/settings/DisplaySettings';
import { SchedulerSettings } from '@/components/settings/SchedulerSettings';
import { IntegrationSettings } from '@/components/settings/IntegrationSettings';
import { WebhookConfig } from '@/components/settings/WebhookConfig';
import { EmailSettings } from '@/components/settings/EmailSettings';
import { QualityGateSettings } from '@/components/settings/QualityGateSettings';
import { QuarantineSettings } from '@/components/settings/QuarantineSettings';
import { AISettings } from '@/components/settings/AISettings';
import { WorkspaceSettings } from '@/components/settings/WorkspaceSettings';
import { CategorySettings } from '@/components/settings/CategorySettings';
import { PRIntegrationSettings } from '@/components/settings/PRIntegrationSettings';
import { useFeatureStore } from '@/store/featureStore';

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as SettingsTab) || 'general',
  }),
});

const TAB_COMPONENTS: Record<SettingsTab, React.ComponentType> = {
  general: GeneralSettings,
  auth: AuthSettings,
  'data-retention': DataRetentionSettings,
  backup: BackupRestoreSettings,
  display: DisplaySettings,
  scheduler: SchedulerSettings,
  integrations: IntegrationSettings,
  webhooks: WebhookConfig,
  email: EmailSettings,
  'quality-gate': QualityGateSettings,
  quarantine: QuarantineSettings,
  ai: AISettings,
  workspaces: WorkspaceSettings,
  categories: CategorySettings,
  'pr-integration': PRIntegrationSettings,
};

const TAB_FEATURE_FLAGS: Partial<Record<SettingsTab, string>> = {
  scheduler: 'scheduled-runs',
  integrations: 'integration-hooks',
  webhooks: 'integration-hooks',
  email: 'integration-hooks',
  quarantine: 'auto-quarantine',
  ai: 'ai-explain',
  'pr-integration': 'pr-comparison',
};

function isTabEnabled(tab: SettingsTab, flags: Record<string, boolean>, flagsLoaded: boolean): boolean {
  const flag = TAB_FEATURE_FLAGS[tab];
  return !flag || !flagsLoaded || flags[flag] !== false;
}

function SettingsPage() {
  const { t } = useTranslation();
  const { tab } = useSearch({ from: '/settings/' });
  const navigate = useNavigate();
  const flags = useFeatureStore((s) => s.flags);
  const flagsLoaded = useFeatureStore((s) => s.loaded);

  const requestedTab = (tab as SettingsTab) || 'general';
  const activeTab = isTabEnabled(requestedTab, flags, flagsLoaded) ? requestedTab : 'general';
  const ActiveComponent = TAB_COMPONENTS[activeTab] ?? GeneralSettings;

  function handleTabChange(newTab: SettingsTab) {
    if (!isTabEnabled(newTab, flags, flagsLoaded)) return;
    navigate({ to: '/settings', search: { tab: newTab }, replace: true });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1
        className="text-xl font-semibold mb-6 text-text-primary"
      >
        {t('settings.title')}
      </h1>

      <div className="flex flex-col md:flex-row gap-6">
        <SettingsNav activeTab={activeTab} onTabChange={handleTabChange} flags={flags} flagsLoaded={flagsLoaded} />
        <div className="flex-1 min-w-0">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
