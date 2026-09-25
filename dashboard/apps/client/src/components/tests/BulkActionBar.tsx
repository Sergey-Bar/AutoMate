import { X, Play, Copy, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { spring } from '@/lib/motion';
import { Button } from '@/components/ui/Button';

interface BulkActionBarProps {
  count: number;
  titles: string[];
  onRerun: () => void;
  onCopy: () => void;
  onExportGrep: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, titles: _titles, onRerun, onCopy, onExportGrep, onClear }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 60, opacity: 0 }}
      transition={spring.snappy}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border-focus shadow-2xl bg-bg-elevated"
      style={{
        boxShadow: '0 8px 32px oklch(0 0 0 / 0.5)',
      }}
    >
      <span className="text-sm font-medium tabular text-text-primary">
        {count} selected
      </span>

      <div className="w-px h-5 bg-border-subtle" />

      <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={onRerun}>
        {`Re-run ${count} test${count > 1 ? 's' : ''}`}
      </Button>
      <Button variant="outline" size="sm" icon={<Copy size={13} />} onClick={onCopy}>
        Copy titles
      </Button>
      <Button variant="outline" size="sm" icon={<FileText size={13} />} onClick={onExportGrep}>
        Export grep
      </Button>

      <div className="w-px h-5 bg-border-subtle" />

      <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear selection" className="!p-1">
        <X size={14} className="text-text-tertiary" />
      </Button>
    </motion.div>
  );
}

