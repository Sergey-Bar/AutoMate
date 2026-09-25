/**
 * jira.ts — Jira integration service
 *
 * Creates bug tickets for failed tests via Jira REST API v2.
 */

interface JiraConfig {
  baseUrl: string;   // e.g. https://myteam.atlassian.net
  apiToken: string;
  email: string;
  projectKey: string;
}

interface FailedTest {
  title: string;
  file: string;
  errorMessage?: string;
  errorStack?: string;
  screenshotUrl?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  self: string;
}

export async function createJiraBug(config: JiraConfig, test: FailedTest): Promise<JiraIssue> {
  const description = [
    `*Test:* ${test.title}`,
    `*File:* \`${test.file}\``,
    '',
    test.errorMessage ? `*Error:*\n{code}${test.errorMessage}{code}` : '',
    test.errorStack ? `*Stack:*\n{code}${test.errorStack.slice(0, 2000)}{code}` : '',
    '',
    test.screenshotUrl ? `[Screenshot|${test.screenshotUrl}]` : '',
    '',
    '_Created automatically by Automate',
  ]
    .filter(Boolean)
    .join('\n');

  const body = {
    fields: {
      project: { key: config.projectKey },
      summary: `[Test Failure] ${test.title}`,
      description,
      issuetype: { name: 'Bug' },
      labels: ['automated-test', 'automate'],
    },
  };

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

  const res = await fetch(`${config.baseUrl}/rest/api/2/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jira API error (${res.status}): ${err}`);
  }

  return res.json() as Promise<JiraIssue>;
}

/**
 * Attach a screenshot to an existing Jira issue.
 */
export async function attachScreenshotToJira(
  config: JiraConfig,
  issueKey: string,
  screenshotBuffer: Buffer,
  filename: string,
): Promise<void> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const formData = new FormData();
  const blob = new Blob([screenshotBuffer], { type: 'image/png' });
  formData.append('file', blob, filename);

  const res = await fetch(`${config.baseUrl}/rest/api/2/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'X-Atlassian-Token': 'no-check',
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Jira attachment failed: ${res.status}`);
  }
}
