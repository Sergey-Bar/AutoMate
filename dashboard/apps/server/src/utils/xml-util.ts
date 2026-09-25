/**
 * XML generation utilities
 */

/**
 * Escapes XML special characters
 */
export function escapeXml(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * JUnit XML test result
 */
export interface JUnitTestCase {
  name: string;
  classname: string;
  time: number; // seconds
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  errorMessage?: string | null;
  errorStack?: string | null;
}

/**
 * JUnit XML test suite
 */
export interface JUnitTestSuite {
  name: string;
  tests: JUnitTestCase[];
}

/**
 * Generates JUnit XML report from test suites
 */
export function generateJUnitXml(suites: JUnitTestSuite[]): string {
  const testsuites = suites.map((suite) => {
    const totalTests = suite.tests.length;
    const failures = suite.tests.filter(
      (t) => t.status === 'failed' || t.status === 'timedOut'
    ).length;
    const skipped = suite.tests.filter((t) => t.status === 'skipped').length;
    const totalTime = suite.tests.reduce((sum, t) => sum + t.time, 0);

    const testcases = suite.tests
      .map((test) => {
        const time = test.time.toFixed(3);
        const classname = escapeXml(test.classname);
        const name = escapeXml(test.name);

        let inner = '';
        if (test.status === 'failed' || test.status === 'timedOut') {
          const message = escapeXml(test.errorMessage || 'Test failed');
          const stack = escapeXml(test.errorStack || '');
          inner = `
      <failure message="${message}">${stack}</failure>`;
        } else if (test.status === 'skipped') {
          inner = `
      <skipped/>`;
        }

        return `    <testcase name="${name}" classname="${classname}" time="${time}">${inner}
    </testcase>`;
      })
      .join('\n');

    return [
      `  <testsuite name="${escapeXml(suite.name)}" tests="${totalTests}" failures="${failures}" skipped="${skipped}" time="${totalTime.toFixed(3)}">`,
      testcases,
      `  </testsuite>`,
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    ...testsuites,
    '</testsuites>',
  ].join('\n');
}
