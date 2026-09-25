/**
 * gitlab.ts — GitLab integration service
 *
 * Posts MR notes and commit statuses via the GitLab REST API.
 */

const MARKER = '<!-- automate-mr -->';

interface GitLabConfig {
  token: string;
  projectId: string;
  baseUrl: string;
}

/**
 * Post or update an MR note with deduplication.
 * Uses a hidden HTML marker to find and update existing notes.
 */
export async function postOrUpdateMrComment(
  config: GitLabConfig,
  mrNumber: number,
  body: string,
): Promise<void> {
  const encodedProject = encodeURIComponent(config.projectId);
  const notesUrl = `${config.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${mrNumber}/notes`;
  const markedBody = MARKER + '\n' + body;

  const listRes = await fetch(notesUrl, {
    headers: {
      'PRIVATE-TOKEN': config.token,
    },
  });

  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`GitLab API error listing MR notes (${listRes.status}): ${text}`);
  }

  const notes = (await listRes.json()) as Array<{ id: number; body: string }>;
  const existing = notes.find((n) => n.body.includes(MARKER));

  if (existing) {
    const putRes = await fetch(`${notesUrl}/${existing.id}`, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': config.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: markedBody }),
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`GitLab API error updating MR note (${putRes.status}): ${text}`);
    }
  } else {
    const postRes = await fetch(notesUrl, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': config.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: markedBody }),
    });

    if (!postRes.ok) {
      const text = await postRes.text();
      throw new Error(`GitLab API error creating MR note (${postRes.status}): ${text}`);
    }
  }
}

/**
 * Create a commit status for a specific SHA.
 */
export async function createCommitStatus(
  config: GitLabConfig,
  sha: string,
  state: 'pending' | 'running' | 'success' | 'failed' | 'canceled',
  description: string,
  targetUrl?: string,
  context?: string,
): Promise<void> {
  const encodedProject = encodeURIComponent(config.projectId);
  const url = `${config.baseUrl}/api/v4/projects/${encodedProject}/statuses/${sha}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': config.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state,
      target_url: targetUrl,
      description,
      context,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab API error creating commit status (${res.status}): ${text}`);
  }
}
