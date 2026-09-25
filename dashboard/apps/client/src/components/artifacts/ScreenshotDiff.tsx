import type { Attachment } from '@/lib/types';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Image as ImageIcon, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ReactCompareSlider } from 'react-compare-slider';
import { cn } from '@/lib/utils';

interface ScreenshotDiffProps {
  /** The attachment that triggered the diff (expected / actual / diff glob) */
  attachment: Attachment;
  /** Optional: provide explicit URLs. If omitted we try to derive from attachment.path */
  expectedUrl?: string;
  actualUrl?: string;
  /** Optional: AI analysis result from the vision diff pipeline */
  aiAnalysis?: { significant: boolean; description: string };
  /** Optional: which pipeline stage produced this diff */
  diffStage?: 'pixel' | 'perceptual' | 'ai';
}

function toArtifactUrl(p: string) {
  return `/artifacts/${p}`;
}
type ViewMode = 'Slider' | 'Side by Side';

export function ScreenshotDiff({ attachment, expectedUrl, actualUrl, aiAnalysis, diffStage }: ScreenshotDiffProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('Slider');
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);

  const handleImageClick = useCallback((url: string) => {
    setZoomedUrl(url);
  }, []);

  const handleCloseZoom = useCallback(() => {
    setZoomedUrl(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseZoom();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseZoom]);
  const base = attachment.path?.replace(/(expected|actual|diff)\.(png|jpg|jpeg)$/i, '') ?? '';

  const expected = expectedUrl ?? toArtifactUrl(`${base}expected.png`);
  const actual = actualUrl ?? toArtifactUrl(`${base}actual.png`);
  const diff = toArtifactUrl(`${base}diff.png`);

  return (
<>
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-text-tertiary">
          Screenshot diff
        </span>
        {diffStage !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated border border-border-subtle text-text-secondary">
            Stage: {diffStage}
          </span>
        )}
        <div className="flex-1" />
        <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
      </div>

      {/* AI analysis badge + description */}
      {aiAnalysis !== undefined && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {aiAnalysis.significant ? (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 font-medium">
                <AlertTriangle className="size-3" />
                Significant
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 font-medium">
                <CheckCircle className="size-3" />
                Cosmetic
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-secondary leading-relaxed">{aiAnalysis.description}</p>
        </div>
      )}

      {/* Main viewer */}
      <div className="rounded-lg overflow-hidden border border-border-subtle min-h-[200px]">
        {viewMode === 'Slider' ? (
          <ReactCompareSlider
            itemOne={
              <ImageWithLoader
                src={expected}
                alt="Expected"
                onClick={() => handleImageClick(expected)}
              />
            }
            itemTwo={
              <ImageWithLoader
                src={actual}
                alt="Actual"
                onClick={() => handleImageClick(actual)}
              />
            }
            style={{ width: '100%' }}
          />
        ) : (
          <div className="grid grid-cols-2">
            <ImageWithLoader
              src={expected}
              alt="Expected"
              onClick={() => handleImageClick(expected)}
            />
            <ImageWithLoader src={actual} alt="Actual" onClick={() => handleImageClick(actual)} />
          </div>
        )}
      </div>

      {/* Diff image */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Expected', url: expected },
          { label: 'Diff', url: diff },
          { label: 'Actual', url: actual },
        ].map(({ label, url }) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="text-[10px] text-text-tertiary">{label}</span>
            <ImageWithLoader
              src={url}
              alt={label}
              className="rounded border border-border-subtle w-full object-contain"
              onClick={() => handleImageClick(url)}
            />
          </div>
        ))}
      </div>
    </div>

    <AnimatePresence>
      {zoomedUrl && <ImageViewer src={zoomedUrl} onClose={handleCloseZoom} />}
    </AnimatePresence>
  </>
  );
}
const viewModeOptions: { id: ViewMode; label: string }[] = [
  { id: 'Slider', label: 'Slider' },
  { id: 'Side by Side', label: 'Side by Side' },
];

function ViewModeToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-bg-elevated p-0.5 border border-border-subtle">
      {viewModeOptions.map((option) => (
        <button
          key={option.id}
          onClick={() => setViewMode(option.id)}
          className={cn(
            'text-[11px] px-2 py-0.5 rounded-full transition-colors',
            viewMode === option.id
              ? 'bg-bg-surface text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ImageWithLoader({
  src,
  alt,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [src]);

  if (hasError) {
    return (
      <div
        className={cn(
          'w-full h-full bg-bg-elevated flex flex-col items-center justify-center text-text-tertiary gap-2 p-4',
          className,
        )}
      >
        <ImageIcon className="size-6" />
        <span className="text-xs text-center">Could not load image</span>
      </div>
    );
  }

  return (
    <div className={cn('relative w-full h-full', className, !isLoaded && 'min-h-[100px]')}>
      {!isLoaded && (
        <div className="absolute inset-0 w-full h-full bg-bg-elevated animate-pulse" />
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        onClick={onClick}
        className={cn(
          'w-full h-full object-contain transition-opacity',
          isLoaded ? 'opacity-100' : 'opacity-0',
          onClick && 'cursor-pointer',
        )}
      />
    </div>
  );
}

function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking on image container
      >
        <img
          src={src}
          alt="Zoomed view"
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 p-1.5 rounded-full bg-bg-surface hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors shadow-lg border border-border-subtle"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </motion.div>
    </motion.div>
  );
}
