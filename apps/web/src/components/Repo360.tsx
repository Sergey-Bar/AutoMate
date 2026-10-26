import React from 'react';
import { ArrowRight, cn } from '@automate/ui';
import type {
  AgentRuntimeReport,
  AiCodeReport,
  DeliveryReport,
  ProjectEvals,
  ProjectHealth,
  Scorecard,
} from '@automate/shared-contracts';
import { useResource, type Resource } from '../hooks/useResource.js';
import type { AgentsClient } from '../lib/agents-client.js';
import type { AiCodeClient } from '../lib/ai-code-client.js';
import type { DeliveryClient } from '../lib/delivery-client.js';
import { rankFixNext, type FixNextItem, type ScorecardSource } from '../lib/fix-next.js';
import type { HealthClient } from '../lib/health-client.js';
import { letterTone } from '../lib/health-view.js';
import type { QaClient } from '../lib/qa-client.js';
import type { SupplyChainClient } from '../lib/supply-chain-client.js';
import { repoHealthPath } from '../route-manifest.js';
import { PageFrame, PageHeader, Panel, Quiet } from './kit.js';
import { Loaded, ProjectPage, projectLink } from './ProjectPage.js';
import { ScorecardCard } from './ScorecardCard.js';

/**
 * Repository 360: the grade, every scorecard beside it, and one list of what to fix next.
 *
 * Each scorecard is its own read, so one failing endpoint costs its card and nothing else —
 * the card says why, and the fix-next list is built from whatever did arrive.
 *
 * Supply chain and test effectiveness are read from their own scorecard endpoints, like every
 * other card, so a failing one says why in its place and its reasons join the fix-next list.
 */
export interface Repo360Clients {
  qa: QaClient;
  health: HealthClient;
  delivery: DeliveryClient;
  aiCode: AiCodeClient;
  agents: AgentsClient;
  supplyChain: SupplyChainClient;
}

export function Repo360Page({
  clients,
  projectId,
}: {
  clients: Repo360Clients;
  projectId: string;
}): React.ReactElement {
  return (
    <ProjectPage
      qa={clients.qa}
      health={clients.health}
      title="Repository 360"
      projectId={projectId}
    >
      {({ project }) => (
        <Repo360Body clients={clients} projectId={project.id} name={project.name} />
      )}
    </ProjectPage>
  );
}

interface Reads {
  health: Resource<ProjectHealth>;
  delivery: Resource<DeliveryReport>;
  aiCode: Resource<AiCodeReport>;
  runtime: Resource<AgentRuntimeReport>;
  evals: Resource<ProjectEvals>;
  supplyChain: Resource<Scorecard>;
  testEffectiveness: Resource<Scorecard>;
}

function useReads(clients: Repo360Clients, projectId: string): Reads {
  return {
    health: useResource(() => clients.health.getHealth(projectId), [clients.health, projectId]),
    delivery: useResource(
      () => clients.delivery.getReport(projectId, 30),
      [clients.delivery, projectId],
    ),
    aiCode: useResource(() => clients.aiCode.getReport(projectId, 90), [clients.aiCode, projectId]),
    runtime: useResource(
      () => clients.agents.getRuntime(projectId, 7),
      [clients.agents, projectId],
    ),
    evals: useResource(() => clients.agents.getEvals(projectId), [clients.agents, projectId]),
    supplyChain: useResource(
      () => clients.supplyChain.getScorecard(projectId),
      [clients.supplyChain, projectId],
    ),
    testEffectiveness: useResource(
      () => clients.health.getTestEffectiveness(projectId),
      [clients.health, projectId],
    ),
  };
}

function ready<T>(resource: Resource<T>): T | null {
  return resource.status === 'ready' ? resource.value : null;
}

/** Every scorecard that has arrived, with the page it links to. */
export function scorecardSources(reads: Reads, projectId: string): ScorecardSource[] {
  const link = (path: string) => projectLink(path, projectId);
  const delivery = ready(reads.delivery);
  const aiCode = ready(reads.aiCode);
  const runtime = ready(reads.runtime);
  const evals = ready(reads.evals);
  const supplyChain = ready(reads.supplyChain);
  const testEffectiveness = ready(reads.testEffectiveness);
  return [
    ...(delivery === null
      ? []
      : [
          { scorecard: delivery.dora, href: link('/dashboard/delivery') },
          { scorecard: delivery.flow, href: link('/dashboard/delivery') },
        ]),
    ...(aiCode === null ? [] : [{ scorecard: aiCode.scorecard, href: link('/dashboard/ai-code') }]),
    ...(runtime === null
      ? []
      : [{ scorecard: runtime.scorecard, href: link('/dashboard/agents') }]),
    ...(evals?.suites ?? []).map((suite) => ({
      scorecard: suite.scorecard,
      href: link('/dashboard/agents'),
    })),
    ...(supplyChain === null
      ? []
      : [{ scorecard: supplyChain, href: link('/dashboard/supply-chain') }]),
    ...(testEffectiveness === null
      ? []
      : [{ scorecard: testEffectiveness, href: repoHealthPath(projectId) }]),
  ];
}

function Repo360Body({
  clients,
  projectId,
  name,
}: {
  clients: Repo360Clients;
  projectId: string;
  name: string;
}): React.ReactElement {
  const reads = useReads(clients, projectId);
  const sources = scorecardSources(reads, projectId);
  const grade = ready(reads.health)?.grade ?? null;
  const fixNext = rankFixNext(grade, sources, { gradeHref: repoHealthPath(projectId) });
  const link = (path: string) => projectLink(path, projectId);
  return (
    <PageFrame data-testid="repo-360" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Repository 360"
        subtitle={`${name}: the grade, every scorecard, and what to fix next`}
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel title="Grade" data-testid="repo-360-grade">
          <Loaded resource={reads.health} label="the grade" testId="repo-360-grade">
            {(value) => <GradeSummary health={value} href={repoHealthPath(projectId)} />}
          </Loaded>
        </Panel>
        <FixNextPanel items={fixNext} settled={settled(reads)} />
      </div>
      <section aria-label="Scorecards" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReadCards
          resource={reads.delivery}
          label="delivery"
          cards={(value) => [value.dora, value.flow]}
          href={link('/dashboard/delivery')}
        />
        <ReadCards
          resource={reads.aiCode}
          label="AI-written code"
          cards={(value) => [value.scorecard]}
          href={link('/dashboard/ai-code')}
        />
        <ReadCards
          resource={reads.runtime}
          label="agent runtime"
          cards={(value) => [value.scorecard]}
          href={link('/dashboard/agents')}
        />
        <ReadCards
          resource={reads.evals}
          label="evals"
          cards={(value) => value.suites.map((suite) => suite.scorecard)}
          href={link('/dashboard/agents')}
        />
        <ReadCards
          resource={reads.supplyChain}
          label="supply chain"
          cards={(value) => [value]}
          href={link('/dashboard/supply-chain')}
        />
        <ReadCards
          resource={reads.testEffectiveness}
          label="test effectiveness"
          cards={(value) => [value]}
          href={repoHealthPath(projectId)}
        />
      </section>
    </PageFrame>
  );
}

function settled(reads: Reads): boolean {
  return Object.values(reads).every((resource) => resource.status !== 'loading');
}

function GradeSummary({
  health,
  href,
}: {
  health: ProjectHealth;
  href: string;
}): React.ReactElement {
  const { grade } = health;
  return (
    <div className="space-y-2">
      <p className="flex items-baseline gap-3">
        <span
          data-testid="repo-360-letter"
          className={cn('text-5xl font-semibold tabular-nums', letterTone(grade.letter))}
        >
          {grade.letter ?? '—'}
        </span>
        <span className="text-sm tabular-nums text-fg-muted">
          {grade.score === null ? 'incomplete' : `${grade.score.toFixed(0)} / 100`}
        </span>
      </p>
      <p className="max-w-measure text-sm text-fg-muted">
        {grade.incomplete ? grade.incompleteReason : grade.limiter}
      </p>
      <InlineLink href={href}>Open the grade</InlineLink>
    </div>
  );
}

function InlineLink({ href, children }: { href: string; children: string }): React.ReactElement {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </a>
  );
}

function FixNextPanel({
  items,
  settled: done,
}: {
  items: readonly FixNextItem[];
  settled: boolean;
}): React.ReactElement {
  return (
    <Panel title="Fix next" data-testid="repo-360-fix-next">
      {items.length === 0 ? (
        <Quiet>
          {done
            ? 'Nothing to fix: no grade item and no failing scorecard.'
            : 'Reading the grade and the scorecards…'}
        </Quiet>
      ) : (
        <ol className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={item.href}
                  className="underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  {item.title}
                </a>
                <p className="text-xs text-fg-muted">{item.source}</p>
              </div>
              {item.gain === null ? null : (
                <span className="shrink-0 tabular-nums text-xs text-fg-muted">
                  {`+${item.gain.toFixed(1)} pts`}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ReadCards<T>({
  resource,
  label,
  cards,
  href,
}: {
  resource: Resource<T>;
  label: string;
  cards: (value: T) => readonly Scorecard[];
  href: string;
}): React.ReactElement {
  if (resource.status !== 'ready') {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <Loaded
          resource={resource}
          label={label}
          testId={`repo-360-${label.replace(/\W+/gu, '-')}`}
        >
          {() => null}
        </Loaded>
      </div>
    );
  }
  const list = cards(resource.value);
  if (list.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <Quiet>{`No ${label} scorecard: nothing has reported.`}</Quiet>
      </div>
    );
  }
  return (
    <>
      {list.map((scorecard) => (
        <ScorecardCard
          key={`${scorecard.id}-${scorecard.title}`}
          scorecard={scorecard}
          href={href}
          compact
          headingLevel={2}
        />
      ))}
    </>
  );
}
