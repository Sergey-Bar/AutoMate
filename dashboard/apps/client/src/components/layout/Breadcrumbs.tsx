import { useMatches, Link } from '@tanstack/react-router';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { ease, safeMotion } from '@/lib/motion';

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/runs': 'Runs',
  '/runs/compare': 'Compare',
  '/tests': 'Tests',
  '/tests/quarantine': 'Quarantine',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
  '/config': 'Config',
  '/baselines': 'Baselines',
  '/tools/codegen': 'Codegen',
};

function resolveLabel(fullPath: string, pathname: string): string | null {
  // Static route label
  if (ROUTE_LABELS[fullPath]) return ROUTE_LABELS[fullPath];

  // Dynamic $runId segment
  const runIdMatch = pathname.match(/^\/runs\/(.+)$/);
  if (runIdMatch && fullPath.startsWith('/runs/') && fullPath !== '/runs/compare') {
    return `Run #${(runIdMatch[1] ?? '').slice(0, 8)}`;
  }

  return null;
}

const fadeVariant = safeMotion({
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: ease.standard },
  exit: { opacity: 0, transition: { duration: 0.08 } },
});

export function Breadcrumbs() {
  const matches = useMatches();
  const portalTarget = typeof document !== 'undefined'
    ? document.getElementById('breadcrumb-portal')
    : null;

  if (!portalTarget) return null;

  // Build crumb list from route matches (skip the root layout match)
  const crumbs: { label: string; to: string }[] = [];
  const pathname = matches.at(-1)?.pathname ?? '/';

  for (const match of matches) {
    const path = match.pathname;
    if (path === '/__root') continue;
    const label = resolveLabel(path, pathname);
    if (label && !crumbs.some((c) => c.to === path)) {
      crumbs.push({ label, to: path });
    }
  }

  // Always include Dashboard as first crumb when not on dashboard
  if (crumbs.length > 0 && crumbs[0]?.to !== '/') {
    crumbs.unshift({ label: 'Dashboard', to: '/' });
  }

  // Single crumb (we're on it) — still show it
  if (crumbs.length === 0) {
    crumbs.push({ label: 'Dashboard', to: '/' });
  }

  return createPortal(
    <AnimatePresence mode="wait">
      <motion.nav
        key={pathname}
        aria-label="Breadcrumb"
        className="flex items-center gap-1"
        {...fadeVariant}
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={crumb.to} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight
                  size={12}
                  className="shrink-0 text-text-tertiary"
                />
              )}
              {isLast ? (
                <span aria-current="page" className="text-sm font-medium text-text-primary">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.to}
                  className="text-sm text-text-tertiary hover:underline underline-offset-2 transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </motion.nav>
    </AnimatePresence>,
    portalTarget,
  );
}
