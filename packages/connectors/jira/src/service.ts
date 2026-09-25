export interface FailedTest {
  title: string;
  file: string;
  errorMessage?: string;
  errorStack?: string;
  screenshotUrl?: string;
}

export function buildJiraDescription(test: FailedTest): string {
  return [
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
}
