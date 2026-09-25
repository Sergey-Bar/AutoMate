import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SettingsSection, SettingRow } from './SettingsSection';

export function GeneralSettings() {
  const [apiUrl, setApiUrl] = useState('http://localhost:4000');
  const [reporterPort, setReporterPort] = useState('4001');

  return (
    <SettingsSection title="Server">
      <SettingRow label="API URL" description="Dashboard backend address">
        <Input
          size="sm"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          style={{ width: '14rem' }}
          aria-label="API URL"
        />
      </SettingRow>
      <SettingRow label="Reporter Port" description="Port ws-reporter connects to">
        <Input
          size="sm"
          value={reporterPort}
          onChange={(e) => setReporterPort(e.target.value)}
          style={{ width: '6rem' }}
          aria-label="Reporter Port"
        />
      </SettingRow>
      <div className="flex justify-end px-4 py-3">
        <Button size="sm">Save</Button>
      </div>
    </SettingsSection>
  );
}
