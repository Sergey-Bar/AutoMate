import type { HealthReportFormat } from '@automate/shared-contracts';

/**
 * The health scanners this install knows how to run, as data.
 *
 * ## Existing tools only, each writing its own report
 *
 * Every row is a well-known scanner invoked with the flags that make it write a report the
 * reporter adapters already read — SARIF for findings, jscpd's JSON for duplication. Nothing
 * here analyses source. A scanner the repository does not need is not proposed, and one the
 * runner has not advertised is reported as not configured rather than silently skipped.
 *
 * ## `executesRepoCode` is the safety line for cloned repositories
 *
 * A git-sourced repository is untrusted: only a scanner that reads files and never runs the
 * repository's code may touch it. `golangci-lint` loads packages through the Go toolchain,
 * so it is marked as executing code; the rest read files. The server enforces the flag, not
 * the caller (see `healthScannersFor`).
 *
 * ## The output lands in the checkout
 *
 * The runner collects artifacts from the command's working directory, so each scanner writes
 * `automate-health-*` at the repository root. Add that pattern to `.gitignore`.
 */
export interface HealthScanner {
  /** Also the runner capability that advertises the binary is installed. */
  id: string;
  label: string;
  argv: readonly string[];
  format: HealthReportFormat;
  /** Repository-relative path of the report, which is also the artifact glob. */
  output: string;
  executesRepoCode: boolean;
  /** `null`: every ecosystem. Otherwise the ecosystems it applies to. */
  ecosystems: readonly string[] | null;
}

export const HEALTH_OUTPUT_PREFIX = 'automate-health-';

const sarif = (id: string) => `${HEALTH_OUTPUT_PREFIX}${id}.sarif`;

export const HEALTH_SCANNERS: readonly HealthScanner[] = [
  {
    id: 'gitleaks',
    label: 'gitleaks',
    argv: [
      'gitleaks',
      'dir',
      '.',
      '--report-format',
      'sarif',
      '--report-path',
      sarif('gitleaks'),
      '--exit-code',
      '0',
      '--no-banner',
      '--redact',
    ],
    format: 'sarif',
    output: sarif('gitleaks'),
    executesRepoCode: false,
    ecosystems: null,
  },
  {
    id: 'semgrep',
    label: 'Semgrep',
    argv: [
      'semgrep',
      'scan',
      '--config',
      'p/default',
      '--sarif',
      '--output',
      sarif('semgrep'),
      '--metrics',
      'off',
      '--disable-version-check',
      '.',
    ],
    format: 'sarif',
    output: sarif('semgrep'),
    executesRepoCode: false,
    ecosystems: null,
  },
  {
    id: 'osv-scanner',
    label: 'OSV-Scanner',
    argv: [
      'osv-scanner',
      '--format',
      'sarif',
      '--output',
      sarif('osv-scanner'),
      '--recursive',
      '.',
    ],
    format: 'sarif',
    output: sarif('osv-scanner'),
    executesRepoCode: false,
    ecosystems: null,
  },
  {
    id: 'trivy',
    label: 'Trivy',
    // Secrets are gitleaks' job: scanning for them twice would count each leak twice.
    argv: [
      'trivy',
      'fs',
      '--scanners',
      'vuln,misconfig,license',
      '--format',
      'sarif',
      '--output',
      sarif('trivy'),
      '--exit-code',
      '0',
      '--quiet',
      '.',
    ],
    format: 'sarif',
    output: sarif('trivy'),
    executesRepoCode: false,
    ecosystems: null,
  },
  {
    id: 'jscpd',
    label: 'jscpd',
    argv: [
      'jscpd',
      '--reporters',
      'json',
      '--output',
      `${HEALTH_OUTPUT_PREFIX}jscpd`,
      '--gitignore',
      '--silent',
      '--ignore',
      `**/${HEALTH_OUTPUT_PREFIX}*/**`,
      '.',
    ],
    format: 'jscpd',
    output: `${HEALTH_OUTPUT_PREFIX}jscpd/jscpd-report.json`,
    executesRepoCode: false,
    ecosystems: null,
  },
  {
    id: 'ruff',
    label: 'Ruff',
    argv: [
      'ruff',
      'check',
      '--output-format',
      'sarif',
      '--output-file',
      sarif('ruff'),
      '--exit-zero',
      '.',
    ],
    format: 'sarif',
    output: sarif('ruff'),
    executesRepoCode: false,
    ecosystems: ['python'],
  },
  {
    id: 'golangci-lint',
    label: 'golangci-lint',
    argv: [
      'golangci-lint',
      'run',
      '--output.sarif.path',
      sarif('golangci-lint'),
      '--issues-exit-code',
      '0',
      './...',
    ],
    format: 'sarif',
    output: sarif('golangci-lint'),
    executesRepoCode: true,
    ecosystems: ['go'],
  },
];

export type RepositorySource = 'local' | 'git';

/**
 * The scanners that apply to a repository, and are safe for where it came from.
 *
 * A git-sourced repository never gets a scanner that executes its code: that is the line
 * between "read what is in the repository" and "run what is in the repository", and it is
 * drawn here so no caller can cross it by naming a scanner.
 */
export function healthScannersFor(
  ecosystem: string | null,
  source: RepositorySource,
): HealthScanner[] {
  return HEALTH_SCANNERS.filter(
    (scanner) =>
      (scanner.ecosystems === null ||
        (ecosystem !== null && scanner.ecosystems.includes(ecosystem))) &&
      (source === 'local' || !scanner.executesRepoCode),
  );
}
