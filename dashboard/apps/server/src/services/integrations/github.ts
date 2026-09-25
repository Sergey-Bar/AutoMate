/**
 * github.ts — GitHub integration service
 *
 * Posts PR comments with run summary via GitHub REST API.
 */

import { isEnabled } from '../feature-flags.js';
import { escapeMarkdown } from '../../utils/sanitize-text.js';

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

interface RunSummary {
  runId: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs?: number;
  branch?: string;
  dashboardUrl?: string;
  failedTests?: Array<{ title: string; file: string; errorMessage?: string }>;
}

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
  title: string;
}

const MAX_ANNOTATIONS_PER_REQUEST = 50;
const MAX_ANNOTATION_MESSAGE_BYTES = 65536;

export async function postPrComment(
  config: GitHubConfig,
  prNumber: number,
  run: RunSummary,
): Promise<void> {
  const emoji = run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⚠️';
  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(1) : '0';
  const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : 'N/A';

  let body = `## ${emoji} Playwright Test Results\n\n`;
  body += `| Metric | Value |\n|---|---|\n`;
  body += `| **Status** | ${run.status} |\n`;
  body += `| **Pass Rate** | ${passRate}% |\n`;
  body += `| **Total** | ${run.total} |\n`;
  body += `| **Passed** | ${run.passed} |\n`;
  body += `| **Failed** | ${run.failed} |\n`;
  body += `| **Flaky** | ${run.flaky} |\n`;
  body += `| **Skipped** | ${run.skipped} |\n`;
  body += `| **Duration** | ${duration} |\n`;
  body += `| **Branch** | ${run.branch ? escapeMarkdown(run.branch) : 'N/A'} |\n\n`;

  if (run.failedTests && run.failedTests.length > 0) {
    body += `### ❌ Failed Tests\n\n`;
    body += `| Test | File | Error |\n|---|---|---|\n`;
    for (const t of run.failedTests.slice(0, 20)) {
      const errMsg = t.errorMessage ? t.errorMessage.slice(0, 80).replace(/\|/g, '\\|').replace(/\n/g, ' ') : '—';
      body += `| ${escapeMarkdown(t.title)} | \`${t.file}\` | ${errMsg} |\n`;
    }
    if (run.failedTests.length > 20) {
      body += `\n_...and ${run.failedTests.length - 20} more failed tests_\n`;
    }
    body += '\n';
  }

  if (run.dashboardUrl) {
    body += `[📊 View in Dashboard](${run.dashboardUrl})\n\n`;
  }

  body += `---\n_Posted by Automate`;

  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${err}`);
  }
}

/**
 * Create a commit status check for a specific SHA.
 */
export async function createCommitStatus(
  config: GitHubConfig,
  sha: string,
  run: RunSummary,
): Promise<void> {
  const state = run.status === 'passed' ? 'success' : run.status === 'failed' ? 'failure' : 'pending';

  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/statuses/${sha}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        state,
        target_url: run.dashboardUrl,
        description: `${run.passed}/${run.total} passed (${run.failed} failed)`,
        context: 'Automate / Playwright',
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`GitHub status API error: ${res.status}`);
  }
}

/**
 * Post or update a PR comment with deduplication.
 * Uses a hidden HTML marker to find and update existing comments.
 */
export async function postOrUpdatePrComment(
  config: GitHubConfig,
  prNumber: number,
  body: string,
): Promise<void> {
  const marker = '<!-- automate-pr -->';
  const markedBody = body + '\n' + marker;

  const listRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${prNumber}/comments`,
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!listRes.ok) {
    throw new Error(`GitHub API error listing comments (${listRes.status}): ${await listRes.text()}`);
  }

  const comments = (await listRes.json()) as Array<{ id: number; body: string }>;
  const existing = comments.find((c) => c.body.includes(marker));

  if (existing) {
    const patchRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/issues/comments/${existing.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: markedBody }),
      },
    );
    if (!patchRes.ok) {
      throw new Error(`GitHub API error updating comment (${patchRes.status}): ${await patchRes.text()}`);
    }
  } else {
    const postRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: markedBody }),
      },
    );
    if (!postRes.ok) {
      throw new Error(`GitHub API error creating comment (${postRes.status}): ${await postRes.text()}`);
    }
  }
}

/**
 * Create a GitHub Check Run for a commit.
 * If the `checks-annotations` feature flag is enabled and annotations are provided,
 * they will be included in the output. GitHub limits 50 annotations per request;
 * if more are provided, additional PATCH requests are made to add the remainder.
 */
export async function createCheckRun(
  config: GitHubConfig,
  sha: string,
  conclusion: 'success' | 'failure' | 'neutral',
  summary: string,
  annotations?: CheckAnnotation[],
): Promise<void> {
  const useAnnotations =
    isEnabled('checks-annotations') && annotations && annotations.length > 0;
  const firstBatch = useAnnotations
    ? annotations!.slice(0, MAX_ANNOTATIONS_PER_REQUEST)
    : undefined;

  const body: Record<string, unknown> = {
    name: 'Automate / Playwright',
    head_sha: sha,
    status: 'completed',
    conclusion,
    output: {
      title: 'Playwright Test Results',
      summary,
      ...(firstBatch ? { annotations: firstBatch } : {}),
    },
  };

  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(`GitHub Check Run API error (${res.status}): ${await res.text()}`);
  }

  // Batch remaining annotations via PATCH
  if (useAnnotations && annotations!.length > MAX_ANNOTATIONS_PER_REQUEST) {
    const checkRunData = (await res.json()) as { id: number };
    const checkRunId = checkRunData.id;
    let offset = MAX_ANNOTATIONS_PER_REQUEST;

    while (offset < annotations!.length) {
      const batch = annotations!.slice(offset, offset + MAX_ANNOTATIONS_PER_REQUEST);
      const patchRes = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}/check-runs/${checkRunId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            output: { title: 'Playwright Test Results', summary, annotations: batch },
          }),
        },
      );
      if (!patchRes.ok) {
        throw new Error(`GitHub Check Run PATCH error (${patchRes.status}): ${await patchRes.text()}`);
      }
      offset += MAX_ANNOTATIONS_PER_REQUEST;
    }
  }
}

/**
 * Build GitHub check run annotations from a list of failed tests.
 * Each failed test maps to one annotation. Truncates messages to GitHub's 64KB limit.
 */
export function buildTestAnnotations(
  failedTests: RunSummary['failedTests'],
): CheckAnnotation[] {
  if (!failedTests) return [];
  return failedTests.map((test) => {
    const rawMessage = test.errorMessage ?? 'Test failed';
    const message =
      Buffer.byteLength(rawMessage, 'utf8') > MAX_ANNOTATION_MESSAGE_BYTES
        ? rawMessage.slice(0, MAX_ANNOTATION_MESSAGE_BYTES)
        : rawMessage;
    return {
      path: test.file || 'playwright.config.ts',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message,
      title: test.title,
    };
  });
}
