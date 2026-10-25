import { describe, expect, it } from 'vitest';
import { HEALTH_REPORT_FORMATS } from '@automate/shared-contracts';
import { HEALTH_OUTPUT_PREFIX, HEALTH_SCANNERS, healthScannersFor } from './scanners.js';

const ids = (list: readonly { id: string }[]) => list.map((scanner) => scanner.id);

describe('healthScannersFor', () => {
  it('proposes the ecosystem-free scanners everywhere, and a linter only where it applies', () => {
    expect(ids(healthScannersFor('node', 'local'))).toEqual([
      'gitleaks',
      'semgrep',
      'osv-scanner',
      'trivy',
      'jscpd',
    ]);
    expect(ids(healthScannersFor('python', 'local'))).toContain('ruff');
    expect(ids(healthScannersFor('go', 'local'))).toContain('golangci-lint');
    expect(ids(healthScannersFor(null, 'local'))).not.toContain('ruff');
  });

  it('never gives a cloned repository a scanner that runs its code', () => {
    expect(ids(healthScannersFor('go', 'git'))).not.toContain('golangci-lint');
    for (const scanner of healthScannersFor('go', 'git'))
      expect(scanner.executesRepoCode).toBe(false);
  });
});

describe('HEALTH_SCANNERS', () => {
  it('writes every report under the shared prefix, in a format the upload door reads, named in its own argv', () => {
    for (const scanner of HEALTH_SCANNERS) {
      expect(scanner.output.startsWith(HEALTH_OUTPUT_PREFIX), scanner.id).toBe(true);
      expect(HEALTH_REPORT_FORMATS).toContain(scanner.format);
      expect(scanner.argv[0]).toBe(scanner.id);
      expect(
        scanner.argv.some((part) => scanner.output.startsWith(part)),
        scanner.id,
      ).toBe(true);
    }
  });

  it('has unique ids, because each is also a runner capability', () => {
    expect(new Set(ids(HEALTH_SCANNERS)).size).toBe(HEALTH_SCANNERS.length);
  });
});
