/**
 * ci-poller.ts — Poll GitHub Actions API for workflow run status by commit SHA
 */
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_PATH = path.resolve(process.cwd(), '.mission-control', 'integrations.json');

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

interface CIStatusResult {
  provider: string;
  status: string;
  url: string;
  runId?: string;
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface WorkflowRunsResponse {
  total_count: number;
  workflow_runs: WorkflowRun[];
}

function readGitHubConfig(): GitHubConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    const gh = config.github as { token?: string; owner?: string; repo?: string } | undefined;
    if (!gh?.token || !gh?.owner || !gh?.repo) return null;
    return { token: gh.token, owner: gh.owner, repo: gh.repo };
  } catch {
    return null;
  }
}

/**
 * Map GitHub Actions status/conclusion to a simplified status string
 */
function mapStatus(run: WorkflowRun): string {
  if (run.status === 'completed') {
    switch (run.conclusion) {
      case 'success':
        return 'success';
      case 'failure':
        return 'failure';
      case 'cancelled':
        return 'cancelled';
      case 'timed_out':
        return 'timed_out';
      default:
        return run.conclusion ?? 'unknown';
    }
  }
  // Still running
  if (run.status === 'in_progress') return 'in_progress';
  if (run.status === 'queued') return 'queued';
  return run.status;
}

/**
 * Poll GitHub Actions for workflow runs matching a commit SHA.
 * Returns the most recent workflow run status, or null if GitHub is not configured.
 */
export async function pollCIStatus(commitSha: string): Promise<CIStatusResult | null> {
  const ghConfig = readGitHubConfig();
  if (!ghConfig) return null;

  const apiUrl = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/actions/runs?head_sha=${commitSha}`;

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${ghConfig.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub Actions API returned ${res.status}`);
  }

  const data = (await res.json()) as WorkflowRunsResponse;

  if (data.total_count === 0 || data.workflow_runs.length === 0) {
    return null;
  }

  // Use the most recent workflow run
  const latest = data.workflow_runs[0];
  if (!latest) return null;

  return {
    provider: 'github',
    status: mapStatus(latest),
    url: latest.html_url,
    runId: String(latest.id),
  };
}
