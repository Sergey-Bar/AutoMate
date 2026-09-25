import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SettingsSection, SettingRow } from './SettingsSection';

interface DbStats {
  sizeBytes: number;
  sizeMB: string;
  pageCount: number;
  pageSize: number;
}

export function BackupRestoreSettings() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: stats } = useQuery<DbStats>({
    queryKey: ['db-stats'],
    queryFn: () => fetch('/api/settings/db-stats').then((r) => r.json()),
  });

  const backupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/backup');
      if (!res.ok) throw new Error('Backup failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `automate-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('Backup downloaded'),
    onError: () => toast.error('Backup failed'),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', selectedFile);
      const res = await fetch('/api/settings/restore', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Restore failed');
      }
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      toast.success(data.message || 'Database restored. Please restart the server.');
      setSelectedFile(null);
      setShowConfirm(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Database Info */}
      <SettingsSection title="Database">
        <SettingRow label="Database Size" description="Current size of the SQLite database">
          <span className="text-sm font-mono text-text-primary">{stats?.sizeMB ?? '—'}</span>
        </SettingRow>
      </SettingsSection>

      {/* Backup */}
      <SettingsSection title="Backup">
        <SettingRow label="Download Backup" description="Download a copy of the entire database">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => backupMutation.mutate()}
            loading={backupMutation.isPending}
            icon={<Download size={13} />}
          >
            Download
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* Restore */}
      <SettingsSection title="Restore">
        <div className="px-4 py-3">
          <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 mb-4">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p className="text-xs text-text-secondary">
              Restoring a database will replace ALL current data. A safety backup is created
              automatically before restore. The server must be restarted after restore.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary cursor-pointer hover:brightness-110 transition-colors">
              <Upload size={13} />
              {selectedFile ? selectedFile.name : 'Choose .db file'}
              <input
                type="file"
                accept=".db"
                className="hidden"
                onChange={(e) => {
                  setSelectedFile(e.target.files?.[0] ?? null);
                  setShowConfirm(false);
                }}
              />
            </label>

            {selectedFile && !showConfirm && (
              <Button variant="danger" size="sm" onClick={() => setShowConfirm(true)}>
                Restore
              </Button>
            )}

            {showConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-fail font-medium">Are you sure?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => restoreMutation.mutate()}
                  loading={restoreMutation.isPending}
                >
                  Yes, Replace Database
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
