import type { ReactNode } from 'react';

/** Card wrapper for a settings section. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border-default overflow-hidden">
      <div
        className="px-4 py-2.5 border-b border-border-subtle text-[11px] font-semibold uppercase tracking-wider bg-bg-surface text-text-tertiary"
      >
        {title}
      </div>
      <div className="bg-bg-surface">{children}</div>
    </div>
  );
}

/** Row inside a SettingsSection — label + description on left, control on right. */
export function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle last:border-0">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-tertiary">{description}</p>
      </div>
      {children}
    </div>
  );
}
