/**
 * reporter-bridge.ts
 *
 * WebSocket hub that:
 * 1. Listens on /reporter — receives events from ws-reporter.ts
 * 2. Persists each event to SQLite via Drizzle
 * 3. Broadcasts to all /ws browser clients
 */
import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client.js';
import { runs, tests, results, qualityGateConfig, failureClassifications, quarantine } from '../db/schema.js';
import { eq, sql, and } from 'drizzle-orm';
import { randomUUID, createHash } from 'crypto';
import * as path from 'path';
import { fingerprintError } from './fingerprint.js';
import { sendSlackRunSummary } from './integrations/slack.js';
import { createJiraBug } from './integrations/jira.js';
import { postPrComment, createCommitStatus, postOrUpdatePrComment } from './integrations/github.js';
import { dispatchAllWebhooks } from './integrations/webhooks.js';
import { sendRunReportEmail } from './integrations/email.js';
import { sendTeamsRunSummary } from './integrations/teams.js';
import { updateTrendsForDate } from './trend-backfill.js';
import { autoQuarantineCheck } from './auto-quarantine.js';
import { classifyFailure, type FailureInput } from './failure-taxonomy.js';
import { resolveBaseRun, compareRunToBase, generatePrCommentMarkdown } from './pr-comparison.js';
import { readConfig } from './integrations/config.js';
import { updateCrossRunClusters } from './failure-cluster-persistence.js';
import { isEnabled } from './feature-flags.js';
import { isSelectorFailure, analyzeAndPersist, type SelectorContext } from './locator-intelligence.js';

function computeStableId(file: string, title: string): string {
  return createHash('sha256').update(file + '\0' + title).digest('hex').slice(0, 16);
}

async function computeGateStatus(runId: string): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.total === 0) return;

  // Resolve config: workspace-specific first, then global fallback
  let cfg: typeof qualityGateConfig.$inferSelect | undefined;
  if (run.workspaceId) {
    const wsCfgs = await db.select().from(qualityGateConfig)
      .where(eq(qualityGateConfig.workspaceId, run.workspaceId));
    cfg = wsCfgs[0];
  }
  if (!cfg) {
    const globalCfgs = await db.select().from(qualityGateConfig)
      .where(eq(qualityGateConfig.id, 'global'));
    cfg = globalCfgs[0];
  }

  const threshold = cfg?.passRateThreshold ?? 100;
  const passRate = (run.passed / run.total) * 100;

  let gateStatus: 'passed' | 'failed' = passRate >= threshold ? 'passed' : 'failed';

  // Check duration threshold
  if (gateStatus === 'passed' && cfg?.maxDurationMs != null && run.durationMs != null) {
    if (run.durationMs > cfg.maxDurationMs) {
      gateStatus = 'failed';
    }
  }

  // Check flaky count threshold
  if (gateStatus === 'passed' && cfg?.maxFlakyCount != null) {
    if (run.flaky > cfg.maxFlakyCount) {
      gateStatus = 'failed';
    }
  }

  // Check quarantine percentage (anti-gaming: gate fails if too many tests quarantined)
  if (gateStatus === 'passed' && cfg?.maxQuarantinePercent != null && run.total > 0) {
    const [countRow] = await db.select({ count: sql<number>`count(distinct ${quarantine.id})`.as('count') })
      .from(quarantine)
      .innerJoin(tests, and(eq(tests.title, quarantine.testTitle), eq(tests.file, quarantine.testFile)))
      .where(and(eq(quarantine.status, 'approved'), eq(tests.runId, runId)));
    const quarantineCount = countRow?.count ?? 0;
    const quarantinePercent = (quarantineCount / run.total) * 100;
    if (quarantinePercent > cfg.maxQuarantinePercent) {
      gateStatus = 'failed';
    }
  }

  await db.update(runs).set({ gateStatus }).where(eq(runs.id, runId));
}


export interface WsEvent {
  type: string;
  runId: string;
  payload: Record<string, unknown>;
}

type Client = { ws: WebSocket; runId?: string };

export class ReporterBridge {
  private clients: Set<Client> = new Set();
  private log: FastifyBaseLogger;

  constructor(log: FastifyBaseLogger) {
    this.log = log;
  }

  /** Register a browser dashboard WebSocket client */
  addClient(ws: WebSocket, runId?: string) {
    const client: Client = { ws, runId };
    this.clients.add(client);
    ws.once('close', () => this.clients.delete(client));
  }

  /** Broadcast an event from the reporter to all interested browser clients */
  broadcast(event: WsEvent) {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (
        client.ws.readyState === 1 /* OPEN */ &&
        (!client.runId || client.runId === event.runId)
      ) {
        try {
          client.ws.send(message);
        } catch (err) {
          this.log.warn({ err }, '[bridge] Failed to send to client, removing');
          this.clients.delete(client);
        }
      }
    }
  }

  /** Handle an inbound event from ws-reporter.ts */
  async handleReporterEvent(raw: string) {
    let event: WsEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      this.log.warn('[bridge] Failed to parse reporter event');
      return;
    }

    // Persist to DB (best-effort — never crash the reporter)
    try {
      await this.persist(event);
    } catch (err) {
      console.error(`[DEBUG] DB persist error: ${(err as Error).message}`, (err as Error).stack);
      this.log.error({ err }, '[bridge] DB persist error');
    }

    // Always broadcast to browser clients
    this.broadcast(event);
  }

  private async persist(event: WsEvent) {
    const { type, runId, payload: p } = event;

    switch (type) {
      case 'run:start': {
        const pr = p.pr as { prNumber?: number; prBranch?: string; baseBranch?: string; commitAuthor?: string } | undefined;
        await db.insert(runs).values({
          id: runId,
          startedAt: new Date().toISOString(),
          status: 'running',
          total: (p.total as number) ?? 0,
          config: JSON.stringify(p.config ?? {}),
          rawArgs: (p.rawArgs as string) ?? '',
          branch: (p.branch as string) ?? null,
          commitSha: (p.commitSha as string) ?? null,
          workspaceId: (p.workspaceId as string) ?? null,
          prNumber: pr?.prNumber ?? null,
          prBranch: pr?.prBranch ?? null,
          baseBranch: pr?.baseBranch ?? null,
          commitAuthor: pr?.commitAuthor ?? null,
        }).onConflictDoNothing();
        // Fire-and-forget webhook dispatch for run:start
        dispatchAllWebhooks('run:start', { runId, total: (p.total as number) ?? 0 }).catch((err) => this.log.warn({ err }, '[bridge] Webhook dispatch error'));
        break;
      }

      case 'test:begin':
        await db.insert(tests).values({
          id: p.testId as string,
          runId,
          title: p.title as string,
          file: p.file as string,
          line: (p.line as number) ?? null,
          column: (p.column as number) ?? null,
          status: 'running',
          tags: JSON.stringify(p.tags ?? []),
          annotations: JSON.stringify(p.annotations ?? []),
          workerIndex: (p.workerIndex as number) ?? null,
          stableId: computeStableId(p.file as string, p.title as string),
        }).onConflictDoNothing();
        break;

      case 'test:end': {
        const status = p.status as string;

        // Normalize attachment paths: strip ARTIFACTS_DIR prefix so stored paths are relative
        const artifactsDir = process.env.ARTIFACTS_DIR ?? path.resolve(process.cwd(), 'test-results');
        type RawAttachment = { name: string; contentType: string; path?: string };
        const rawAttachments = (p.attachments as RawAttachment[]) ?? [];
        const normalizedAttachments = rawAttachments.map((a) => ({
          ...a,
          path: a.path && path.isAbsolute(a.path) && a.path.startsWith(artifactsDir)
            ? path.relative(artifactsDir, a.path)
            : a.path,
        }));

        const resultId = randomUUID();

        // Wrap all DB writes for a single test:end event in a transaction
        // to ensure atomicity (test update + result insert + run counter increment).
        await db.transaction(async (tx) => {
          await tx.update(tests)
            .set({
              status: status as typeof tests.$inferInsert['status'],
              durationMs: p.durationMs as number,
              ...(p.tags !== undefined ? { tags: JSON.stringify(p.tags) } : {}),
              ...(p.annotations !== undefined ? { annotations: JSON.stringify(p.annotations) } : {}),
            })
            .where(and(eq(tests.id, p.testId as string), eq(tests.runId, runId)));

          await tx.insert(results).values({
            id: resultId,
            testId: p.testId as string,
            runId,
            retry: (p.retry as number) ?? 0,
            status: status as typeof results.$inferInsert['status'],
            durationMs: (p.durationMs as number) ?? null,
            startedAt: new Date().toISOString(),
            errorMessage: (p.error as Record<string, string> | undefined)?.message ?? null,
            errorStack: (p.error as Record<string, string> | undefined)?.stack ?? null,
            workerIndex: (p.workerIndex as number) ?? null,
            parallelIndex: (p.parallelIndex as number) ?? null,
            stdout: JSON.stringify(p.stdout ?? []),
            stderr: JSON.stringify(p.stderr ?? []),
            steps: JSON.stringify(p.steps ?? []),
            attachments: JSON.stringify(normalizedAttachments),
            fingerprint: fingerprintError((p.error as Record<string, string> | undefined)?.message ?? null),
          });

          // Counter increment using Drizzle-way (driver agnostic)
          if (status === 'passed') {
            await tx.update(runs).set({ passed: sql`${runs.passed} + 1` }).where(eq(runs.id, runId));
          } else if (status === 'failed' || status === 'timedOut') {
            await tx.update(runs).set({ failed: sql`${runs.failed} + 1` }).where(eq(runs.id, runId));
          } else if (status === 'flaky') {
            await tx.update(runs).set({ flaky: sql`${runs.flaky} + 1` }).where(eq(runs.id, runId));
          } else if (status === 'skipped') {
            await tx.update(runs).set({ skipped: sql`${runs.skipped} + 1` }).where(eq(runs.id, runId));
          }
        });
        // Auto-classify failed results (fire-and-forget, fail-safe)
        if (status === 'failed') {
          const classifyInput: FailureInput = {
            resultId,
            errorMessage: (p.error as Record<string, string> | undefined)?.message ?? null,
            errorStack: (p.error as Record<string, string> | undefined)?.stack ?? null,
            testName: (p.title as string) ?? '',
            runId,
            filePath: (p.file as string) ?? null,
          };
          try {
            const cls = classifyFailure(classifyInput);
            await db.insert(failureClassifications).values({
              id: randomUUID(),
              fingerprint: fingerprintError(classifyInput.errorMessage) ?? randomUUID(),
              runId,
              category: cls.category,
              confidence: cls.confidence,
              matchedRuleId: cls.matchedRuleId,
              rationale: cls.evidence,
              isManualOverride: false,
              createdAt: new Date().toISOString(),
            }).onConflictDoNothing();
          } catch (err) {
            this.log.warn({ err }, '[bridge] Classification failed (non-fatal)');
          }
        }
        // Fire-and-forget webhook dispatch for test:fail
        if (status === 'failed') {
          dispatchAllWebhooks('test:fail', {
            runId,
            testId: p.testId as string,
            title: (p.title as string) ?? '',
            file: (p.file as string) ?? '',
            error: (p.error as Record<string, string> | undefined)?.message ?? null,
          }).catch((err) => this.log.warn({ err }, '[bridge] Webhook dispatch error'));
        }
        // Locator intelligence — queue selector healing (fire-and-forget, fail-safe)
        if (status === 'failed' && isEnabled('locator-intelligence')) {
          const errorMessage = (p.error as Record<string, string> | undefined)?.message ?? null;
          if (isSelectorFailure(errorMessage)) {
            const selectorMatch = errorMessage?.match(/["'`]([^"'`]+)["'`]/) ?? null;
            const originalSelector = selectorMatch?.[1] ?? '';
            if (originalSelector) {
              const context: SelectorContext = {
                originalSelector,
                errorMessage,
              };
              analyzeAndPersist(p.testId as string, runId, resultId, context).catch((err) =>
                this.log.warn({ err }, '[bridge] Locator analysis failed (non-fatal)'),
              );
            }
          }
        }
        break;
      }

      case 'run:end':
        await db
          .update(runs)
          .set({
            status: p.status as typeof runs.$inferInsert['status'],
            finishedAt: new Date().toISOString(),
            durationMs: (p.durationMs as number) ?? null,
          })
          .where(eq(runs.id, runId));
        await computeGateStatus(runId);
        // Fire-and-forget integration dispatches
        this.dispatchIntegrations(runId).catch((err) =>
          this.log.error({ err }, '[bridge] Integration dispatch error'),
        );
        // Update daily trends (fire-and-forget)
        updateTrendsForDate(new Date().toISOString().split('T')[0] ?? new Date().toISOString().slice(0, 10)).catch((err) =>
          this.log.error({ err }, '[bridge] Trend update error'),
        );
        // Auto-quarantine flaky tests (fire-and-forget)
        autoQuarantineCheck().catch((err) =>
          this.log.error({ err }, '[bridge] Auto-quarantine check error'),
        );
        // Cross-run failure cluster persistence (fire-and-forget)
        if (isEnabled('cross-run-clusters')) {
          updateCrossRunClusters(runId).catch((err) =>
            this.log.error({ err }, '[bridge] Cross-run cluster update error'),
          );
        }
        break;

      default:
        // step:begin, step:end, stdout, stderr — broadcast-only, no DB write
        break;
    }
  }

  /**
   * Read integration config and dispatch notifications to all enabled services.
   * Fire-and-forget — errors are logged but never propagate.
   */
  private async dispatchIntegrations(runId: string): Promise<void> {
    const config = readConfig();

    // Query the completed run
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (!run) return;

    const publicBase = (process.env.PUBLIC_DASHBOARD_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, '');
    const dashboardUrl = `${publicBase}/runs/${runId}`;
    const runSummary = {
      runId: run.id,
      status: run.status ?? 'unknown',
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      flaky: run.flaky,
      skipped: run.skipped,
      durationMs: run.durationMs ?? undefined,
      branch: run.branch ?? undefined,
      dashboardUrl,
    };

    // --- Slack ---
    if (config.slack?.enabled && config.slack?.webhookUrl) {
      const shouldNotify =
        config.slack.notifyOn?.includes('all') ||
        config.slack.notifyOn?.includes(run.status as 'passed' | 'failed' | 'all');
      if (shouldNotify) {
        try {
          await sendSlackRunSummary(config.slack.webhookUrl, runSummary);
          this.log.info('[bridge] Slack notification sent');
        } catch (err) {
          this.log.error({ err }, '[bridge] Slack notification failed');
        }
      }
    }

    // --- Teams ---
    if (config.teams?.enabled && config.teams?.webhookUrl) {
      const shouldNotify =
        config.teams.notifyOn?.includes('all') ||
        config.teams.notifyOn?.includes(run.status as string);
      if (shouldNotify) {
        try {
          await sendTeamsRunSummary(config.teams.webhookUrl, runSummary);
          this.log.info('[bridge] Teams notification sent');
        } catch (err) {
          this.log.error({ err }, '[bridge] Teams notification failed');
        }
      }
    }

    // --- Email ---
    if (config.email?.enabled && config.email?.recipients?.length) {
      try {
        await sendRunReportEmail(
          {
            host: config.email.host as string,
            port: config.email.port as number,
            secure: config.email.secure as boolean,
            user: config.email.user as string,
            pass: config.email.pass as string,
          },
          config.email.recipients,
          runSummary,
        );
        this.log.info('[bridge] Email report sent');
      } catch (err) {
        this.log.error({ err }, '[bridge] Email report failed');
      }
    }

    // --- Jira (auto-create bugs for failed tests) ---
    if (config.jira?.enabled && config.jira?.autoCreateBugs && run.failed > 0) {
      const failedWithErrors = await db
        .select({
          id: tests.id,
          title: tests.title,
          file: tests.file,
          errorMessage: results.errorMessage,
          errorStack: results.errorStack,
        })
        .from(tests)
        .leftJoin(results, and(eq(results.runId, sql`${runId}`), eq(results.testId, tests.id)))
        .where(and(eq(tests.runId, runId), eq(tests.status, 'failed')))
        .limit(10);

      for (const t of failedWithErrors) {
        try {
          await createJiraBug(
            {
              baseUrl: config.jira.baseUrl as string,
              apiToken: config.jira.apiToken as string,
              email: config.jira.email as string,
              projectKey: config.jira.projectKey as string,
            },
            {
              title: t.title,
              file: t.file,
              errorMessage: t.errorMessage ?? undefined,
              errorStack: t.errorStack ?? undefined,
            },
          );
          this.log.info({ test: t.title }, '[bridge] Jira bug created');
        } catch (err) {
          this.log.error({ err, test: t.title }, '[bridge] Jira bug creation failed');
        }
      }
    }

    // --- GitHub (PR comment + commit status) ---
    if (config.github?.enabled) {
      const ghConfig = {
        token: config.github.token as string,
        owner: config.github.owner as string,
        repo: config.github.repo as string,
      };

      // Build failed tests list for PR comment
      let failedTests: Array<{ title: string; file: string; errorMessage?: string }> | undefined;
      if (run.failed > 0) {
        const failedWithErrors = await db
          .select({
            title: tests.title,
            file: tests.file,
            errorMessage: results.errorMessage,
          })
          .from(tests)
          .leftJoin(results, and(eq(results.runId, sql`${runId}`), eq(results.testId, tests.id)))
          .where(and(eq(tests.runId, runId), eq(tests.status, 'failed')))
          .limit(20);

        failedTests = failedWithErrors.map((t) => ({
          title: t.title,
          file: t.file,
          errorMessage: t.errorMessage ?? undefined,
        }));
      }

      const ghRunSummary = { ...runSummary, failedTests };

      // PR Comment (if prComments enabled and we have PR metadata)
      if (config.github.prComments && run.commitSha) {
        const prMatch = run.branch?.match(/\/(\d+)/) ?? run.commitMessage?.match(/#(\d+)/);
        if (prMatch) {
          try {
            await postPrComment(ghConfig, parseInt(prMatch[1] ?? '0', 10), ghRunSummary);
            this.log.info('[bridge] GitHub PR comment posted');
          } catch (err) {
            this.log.error({ err }, '[bridge] GitHub PR comment failed');
          }
        }
      }

      // Commit status (if commitStatus enabled and we have a SHA)
      if (config.github.commitStatus && run.commitSha) {
        try {
          await createCommitStatus(ghConfig, run.commitSha, ghRunSummary);
          this.log.info('[bridge] GitHub commit status created');
        } catch (err) {
          this.log.error({ err }, '[bridge] GitHub commit status failed');
        }
      }

      // Auto PR comparison comment (if run has explicit PR number from metadata)
      if (run.prNumber && config.github.prComments) {
        try {
          const baseBranch = run.baseBranch ?? config.github.defaultBaseBranch ?? 'main';
          const baseRunId = await resolveBaseRun(baseBranch, run.workspaceId ?? undefined);
          if (baseRunId) {
            const comparison = await compareRunToBase(runId, baseRunId, {
              ignoreQuarantined: config.github.ignoreFlakyInComments ?? false,
            });
            const markdown = generatePrCommentMarkdown(comparison, {
              prNumber: run.prNumber,
              runId,
              dashboardUrl: runSummary.dashboardUrl,
            });
            await postOrUpdatePrComment(ghConfig, run.prNumber, markdown);
            this.log.info('[bridge] PR comparison comment posted (auto)');
          }
        } catch (err) {
          this.log.error({ err }, '[bridge] Auto PR comparison comment failed');
        }
      }

    }

    // --- Generic Webhooks ---
    await dispatchAllWebhooks('run:end', {
      runId: run.id,
      status: run.status ?? 'unknown',
      passed: run.passed,
      failed: run.failed,
      total: run.total,
    });

    // --- Automate result callback ---
    if (isEnabled('result-callback')) {
      const callbackUrl = process.env.AUTOMATE_CALLBACK_URL ?? '';
      const serviceSecret = process.env.AUTOMATE_SERVICE_SECRET ?? '';
      if (callbackUrl && serviceSecret) {
        const publicBase = (process.env.PUBLIC_DASHBOARD_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, '');
        const callbackBody = {
          runId: run.id,
          status: run.status ?? 'unknown',
          total: run.total,
          passed: run.passed,
          failed: run.failed,
          flaky: run.flaky,
          skipped: run.skipped,
          durationMs: run.durationMs ?? undefined,
          dashboardUrl: `${publicBase}/runs/${run.id}`,
        };
        try {
          await fetch(`${callbackUrl}/api/service/run-callback`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Service-Auth': `Bearer ${serviceSecret}`,
            },
            body: JSON.stringify(callbackBody),
          });
          this.log.info('[bridge] Automate result callback sent');
        } catch (err) {
          this.log.error({ err }, '[bridge] Automate result callback failed');
        }
      }
    }
  }
}
