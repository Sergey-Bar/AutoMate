import React from 'react';
import { Link } from '@tanstack/react-router';
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  OctagonX,
  Sparkles,
  cn,
} from '@automate/ui';
import type { DigestItem, ReadinessReason, ReleaseReadinessCard } from '../lib/qa.js';

/**
 * Release readiness, as one line a lead reads before anything else on the screen.
 *
 * ## The verdict is a word, an icon and a colour, never only a colour
 *
 * "Go", "Caution" and "No-go" are spelled out and carry their own glyph, so the verdict
 * survives a monochrome display, a colour-vision deficiency, and a screen reader. The
 * verdict itself is computed by `evaluateReadiness` in `@automate/reporting`; this file only
 * draws it.
 */
const VERDICT = {
  go: { label: 'Go', Icon: CircleCheck, tone: 'text-success', ring: 'border-success' },
  caution: { label: 'Caution', Icon: CircleAlert, tone: 'text-warning', ring: 'border-warning' },
  'no-go': { label: 'No-go', Icon: OctagonX, tone: 'text-danger', ring: 'border-danger' },
} as const;

const LEVEL = {
  go: { Icon: CircleCheck, tone: 'text-success', word: 'passes' },
  caution: { Icon: CircleAlert, tone: 'text-warning', word: 'caution' },
  unknown: { Icon: CircleHelp, tone: 'text-fg-muted', word: 'unknown' },
  'no-go': { Icon: OctagonX, tone: 'text-danger', word: 'blocks' },
} as const;

const DIGEST_TONE = { good: 'text-success', bad: 'text-danger', neutral: 'text-fg-muted' } as const;

/** The reason the card leads with: the worst one, or a sentence that everything passed. */
export function headline(card: ReleaseReadinessCard): string {
  const [first] = card.reasons;
  if (first === undefined || first.level === 'go') return 'Every readiness check passes';
  return first.message;
}

export function ReadinessReasons({
  reasons,
}: {
  reasons: readonly ReadinessReason[];
}): React.ReactElement {
  return (
    <ul className="space-y-2" data-testid="readiness-reasons">
      {reasons.map((reason) => {
        const level = LEVEL[reason.level];
        return (
          <li key={reason.code} className="flex items-start gap-2 text-sm">
            <level.Icon
              size={16}
              aria-hidden="true"
              className={cn('mt-0.5 shrink-0', level.tone)}
            />
            <span className="min-w-0">
              <span className="sr-only">{level.word}: </span>
              {reason.message}
              <span className="block truncate text-xs text-fg-muted" title={reason.evidence}>
                {reason.evidence}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The strip across the top of the dashboard: verdict, the reason that set it, and the week's
 * news. "Why" opens every reason with its evidence.
 */
export function ReadinessStrip({
  readiness,
  failure,
  digest,
}: {
  readiness: ReleaseReadinessCard | null;
  failure: string | null;
  digest: readonly DigestItem[];
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const verdict = readiness === null ? null : VERDICT[readiness.verdict];
  return (
    <section
      aria-label="Release readiness"
      data-testid="readiness-strip"
      className={cn(
        'flex min-h-14 shrink-0 items-center gap-3 rounded-2xl border bg-surface-raised px-3 shadow-elevation-1 sm:px-4',
        verdict?.ring ?? 'border-border',
      )}
    >
      {verdict === null || readiness === null ? (
        <span className="truncate text-sm text-fg-muted" data-testid="readiness-pending">
          {failure === null ? 'Reading release readiness…' : `Readiness unread: ${failure}`}
        </span>
      ) : (
        <>
          <span
            data-testid="readiness-verdict"
            className={cn('inline-flex shrink-0 items-center gap-2', verdict.tone)}
          >
            <verdict.Icon size={22} aria-hidden="true" />
            <span className="text-xl font-light tracking-tight sm:text-2xl">{verdict.label}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-sm" title={headline(readiness)}>
            {headline(readiness)}
          </span>
          <DigestChips digest={digest} />
          <button
            type="button"
            data-testid="readiness-why"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm text-accent hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            Why
            <span className="sr-only"> this verdict</span>
          </button>
          <Dialog
            open={open}
            onOpenChange={(next) => (next ? undefined : setOpen(false))}
            data-testid="readiness-dialog"
          >
            {open ? (
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Release readiness: {verdict.label}</DialogTitle>
                  <DialogDescription>
                    Every check, worst first. A missing input is unknown, never a pass.
                  </DialogDescription>
                </DialogHeader>
                <ReadinessReasons reasons={readiness.reasons} />
              </DialogContent>
            ) : null}
          </Dialog>
        </>
      )}
    </section>
  );
}

/** The week's news as chips, from `md` up. A phone has room for the verdict and its reason. */
function DigestChips({ digest }: { digest: readonly DigestItem[] }): React.ReactElement | null {
  if (digest.length === 0) return null;
  return (
    <ul
      aria-label="Since the previous window"
      className="hidden shrink-0 items-center gap-2 xl:flex"
      data-testid="digest-chips"
    >
      <Sparkles size={14} aria-hidden="true" className="text-fg-muted" />
      {digest.slice(0, 3).map((item) => (
        <li
          key={`${item.kind}-${item.text}`}
          className={cn(
            'whitespace-nowrap rounded-full bg-surface-muted px-2.5 py-1 text-xs',
            DIGEST_TONE[item.tone],
          )}
        >
          {item.text}
        </li>
      ))}
      <li>
        <Link
          to="/dashboard/insights"
          className="inline-flex min-h-11 items-center rounded-sm px-1 text-xs text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          Insights
        </Link>
      </li>
    </ul>
  );
}
