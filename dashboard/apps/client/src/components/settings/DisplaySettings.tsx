import { useState } from 'react';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection, SettingRow } from './SettingsSection';

export function DisplaySettings() {
  const [animations, setAnimations] = useState(true);
  const [tabularNumbers, setTabularNumbers] = useState(true);

  return (
    <SettingsSection title="Display">
      <SettingRow label="Animations" description="Framer Motion micro-interactions">
        <Toggle checked={animations} onChange={setAnimations} />
      </SettingRow>
      <SettingRow label="Tabular numbers" description="Monospace digits on counters">
        <Toggle checked={tabularNumbers} onChange={setTabularNumbers} />
      </SettingRow>
    </SettingsSection>
  );
}
