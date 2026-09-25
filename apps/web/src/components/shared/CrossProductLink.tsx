import { ExternalLink } from 'lucide-react';

export interface CrossProductLinkProps {
  targetApp: 'ai' | 'dashboard';
  path: string;
  context?: string;
  label: string;
  className?: string;
}

function isEmbeddedWindow(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.self !== window.top;
  } catch {
    return false;
  }
}

function normalizeAppPath(targetApp: 'ai' | 'dashboard', path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const appPrefix = targetApp === 'ai' ? '/ai' : '/dashboard';

  if (normalized.startsWith(`${appPrefix}/app`)) return normalized;
  if (normalized.startsWith(appPrefix)) return `${appPrefix}/app${normalized.slice(appPrefix.length)}`;

  return `${appPrefix}/app${normalized}`;
}

export function buildCrossProductAppPath(targetApp: 'ai' | 'dashboard', path: string): string {
  return normalizeAppPath(targetApp, path);
}

export function CrossProductLink({ targetApp, path, context, label, className }: CrossProductLinkProps) {
  const embedded = isEmbeddedWindow();
  const appPath = normalizeAppPath(targetApp, path);

  if (typeof window === 'undefined') {
    return (
      <span data-automate-link={`${targetApp}:${path}`} className={className || 'inline-flex items-center gap-1.5 text-sm text-blue-400'}>
        {label}
      </span>
    );
  }

  const handleClick = () => {
    if (embedded) {
      window.parent.postMessage(
        { type: 'navigate-cross', targetApp, path, context },
        window.location.origin,
      );
      return;
    }

    window.open(`${window.location.origin}${appPath}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      data-automate-link={`${targetApp}:${path}`}
      className={className || 'inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors'}
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );
}
