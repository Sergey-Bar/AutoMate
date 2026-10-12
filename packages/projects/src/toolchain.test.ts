import { describe, expect, it } from 'vitest';
import { literalView } from './detect/repository-view.js';
import { QA_TOOLS_REGISTRY } from './tool-catalog.js';
import { parseManifest, probeToolchain } from './toolchain.js';

/**
 * The probe, tested against a literal repository.
 *
 * The point of the module is that "what is missing from this stack" is answered
 * by the repository rather than by a list the client imagined. A test that
 * mounts a browser component cannot assert that; a literal map can, and the
 * assertions below are about *evidence* — every detected tool names the string
 * that proved it, and an undetected tool names nothing at all.
 */

/** The detection for one tool id, or undefined if the probe did not answer. */
function detectionFor(
  detections: readonly {
    toolId: string;
    detected: boolean;
    evidence: string | null;
    version: string | null;
  }[],
  toolId: string,
) {
  return detections.find((detection) => detection.toolId === toolId);
}

describe('probeToolchain', () => {
  it('answers for every tool in the catalogue, so no row is silently skipped', async () => {
    const detections = await probeToolchain(literalView({}));
    expect(detections).toHaveLength(QA_TOOLS_REGISTRY.length);
  });

  it('detects a tool by the path that proves it', async () => {
    const view = literalView({ 'vitest.config.ts': 'export default {};' });
    const vitest = detectionFor(await probeToolchain(view), 'vitest');
    expect(vitest?.detected).toBe(true);
    // **The evidence is the path, not a claim.** A detection with no evidence is
    // a guess; the screen renders this string, and a reader can check it.
    expect(vitest?.evidence).toBe('vitest.config.ts');
  });

  it('detects a tool a manifest declares even when its config is not written yet', async () => {
    // A project that installs `@playwright/test` and has not written its config
    // has the tool. The old client-side file list could not know that, which is
    // why this probe exists.
    const view = literalView({
      'package.json': JSON.stringify({ devDependencies: { '@playwright/test': '^1.47.0' } }),
    });
    const playwright = detectionFor(await probeToolchain(view), 'playwright');
    expect(playwright?.detected).toBe(true);
    expect(playwright?.evidence).toContain('package.json');
    expect(playwright?.evidence).toContain('@playwright/test');
    expect(playwright?.version).toBe('^1.47.0');
  });

  it('reads the version the manifest declares, for a path-detected tool too', async () => {
    // The config file proves the tool is wired in; the manifest says which
    // version. Both are useful, and the second only exists server-side.
    const view = literalView({
      'vitest.config.ts': 'export default {};',
      'package.json': JSON.stringify({ devDependencies: { vitest: '^2.1.8' } }),
    });
    const vitest = detectionFor(await probeToolchain(view), 'vitest');
    expect(vitest?.version).toBe('^2.1.8');
  });

  it('says null rather than guessing a version the repository never declared', async () => {
    const view = literalView({ 'vitest.config.ts': 'export default {};' });
    const vitest = detectionFor(await probeToolchain(view), 'vitest');
    expect(vitest?.version).toBeNull();
  });

  it('reports an uninstalled tool as undetected with no evidence at all', async () => {
    // **No fabricated path.** The coverage figure is computed from this join, so
    // an invented evidence string would be a number nobody can check.
    const view = literalView({ 'package.json': JSON.stringify({ name: 'empty' }) });
    const cypress = detectionFor(await probeToolchain(view), 'cypress');
    expect(cypress?.detected).toBe(false);
    expect(cypress?.evidence).toBeNull();
    expect(cypress?.version).toBeNull();
  });

  it('records an environment override as an environment claim, not as a file', async () => {
    // A tool installed on the runner rather than in the project is a different
    // claim, and the evidence line has to say which kind it is — otherwise the
    // reader cannot tell an installed tool from an environment's assertion.
    const detections = await probeToolchain(literalView({}), { versions: { k6: 'v0.52.0' } });
    const k6 = detectionFor(detections, 'k6');
    expect(k6?.detected).toBe(true);
    expect(k6?.evidence).toBe('environment → k6@v0.52.0');
    expect(k6?.version).toBe('v0.52.0');
    // Every other tool is still undetected: the override is for one id.
    const others = detections.filter((detection) => detection.toolId !== 'k6');
    expect(others.every((detection) => detection.detected === false)).toBe(true);
  });

  it('survives a manifest it cannot parse', async () => {
    // A malformed package.json is a repository with a problem, not a probe that
    // should crash. The API answers "not detected" and the screen says so.
    const view = literalView({ 'package.json': '{ "devDependencies": ' });
    await expect(probeToolchain(view)).resolves.toHaveLength(QA_TOOLS_REGISTRY.length);
  });

  it('reads a requirements.txt declaration', async () => {
    const view = literalView({ 'requirements.txt': 'pytest==8.3.4\nrequests\n' });
    const pytest = detectionFor(await probeToolchain(view), 'pytest');
    expect(pytest?.detected).toBe(true);
    expect(pytest?.evidence).toContain('requirements.txt');
    expect(pytest?.version).toBe('==8.3.4');
  });

  it('prefers the first manifest when a repository declares the tool in two', async () => {
    // A monorepo root and a service both declaring the tool is one tool, and the
    // version reported should be the one the first manifest states rather than a
    // coin flip between them.
    const view = literalView({
      'package.json': JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }),
      'pyproject.toml': '[project]\nname = "svc"\ndependencies = ["vitest"]',
    });
    const vitest = detectionFor(await probeToolchain(view), 'vitest');
    expect(vitest?.version).toBe('^2.0.0');
  });

  it('reads a go.mod declaration, taking the last segment of the module path', async () => {
    // `github.com/grafana/k6 v0.52.0` declares `k6`, which is the id the
    // catalogue uses — and the `m` flag is what makes `^` match each `require`
    // line rather than only the start of the file.
    const declarations = parseManifest(
      'go.mod',
      'module example.com/svc\n\ngo 1.23\n\nrequire (\n\tgithub.com/grafana/k6 v0.52.0\n)\n',
    );
    expect(declarations.get('k6')).toBe('0.52.0');
  });

  it('reads a pyproject declaration, with the caret stripped from the range', async () => {
    // PEP 621 and Poetry both write `name = "^1.2"` under a dependencies table.
    // The caret is a *range* operator, not part of the version, and printing
    // "^1.2.3" beside a tool is a claim the repository did not make.
    const view = literalView({
      'pyproject.toml': '[project]\nname = "svc"\ndependencies = [\n  "semgrep>=1.97",\n]\n',
    });
    const semgrep = detectionFor(await probeToolchain(view), 'semgrep');
    expect(semgrep?.detected).toBe(true);
    expect(semgrep?.evidence).toContain('pyproject.toml');
  });

  it('reads a Cargo declaration', async () => {
    const declarations = parseManifest(
      'Cargo.toml',
      '[package]\nname = "svc"\n\n[dependencies]\nserde = { version = "1.0.210", features = ["derive"] }\n',
    );
    expect(declarations.get('serde')).toBe('1.0.210');
    const view = literalView({ 'Cargo.toml': 'x' });
    expect(detectionFor(await probeToolchain(view), 'k6')?.detected).toBe(false);
  });

  it('reads a Gemfile declaration, with and without a version', async () => {
    // **The second quote belongs to the same line.** A Gemfile line is a
    // statement; scanning the file for the next quote would report the *next*
    // gem's name as this one's version, which is a version nobody declared.
    const declarations = parseManifest(
      'Gemfile',
      "source 'https://rubygems.org'\ngem 'brakeman'\ngem 'rubocop', '1.60.2'\n",
    );
    expect(declarations.get('brakeman')).toBeNull();
    expect(declarations.get('rubocop')).toBe('1.60.2');
  });

  it('reads a pom declaration without pretending to know its versions', async () => {
    const view = literalView({
      'pom.xml':
        '<project><dependencies><dependency><groupId>io.rest-assured</groupId><artifactId>rest-assured</artifactId></dependency></dependencies></project>',
    });
    const restAssured = detectionFor(await probeToolchain(view), 'rest-assured');
    expect(restAssured?.detected).toBe(true);
    expect(restAssured?.evidence).toContain('pom.xml');
    expect(restAssured?.version).toBeNull();
  });

  it('skips comments and option lines in a requirements file', async () => {
    // A comment is not a package, and `-r other.txt` is a pointer to one. A
    // reader that named either as a dependency would report a tool nobody
    // installed.
    const view = literalView({
      'requirements.txt':
        '# test deps\n-r base.txt\n--index-url https://pypi.org/simple\npytest==8.3.4\n',
    });
    const detections = await probeToolchain(view);
    expect(detectionFor(detections, 'pytest')?.detected).toBe(true);
    expect(detectionFor(detections, 'rest-assured')?.detected).toBe(false);
  });

  it('reports a package.json that is not an object as no declarations at all', async () => {
    // `["not","an","object"]` parses as JSON and has no dependency tables. A
    // probe that threw here would crash a dashboard over a malformed manifest.
    const view = literalView({ 'package.json': '["an array, not a manifest"]' });
    await expect(probeToolchain(view)).resolves.toHaveLength(QA_TOOLS_REGISTRY.length);
    const detections = await probeToolchain(view);
    expect(detections.every((detection) => detection.detected === false)).toBe(true);
  });

  it('lets an environment override stand in for a path-detected tool with no version', async () => {
    // The override is the claim of last resort, and a path-detected tool with no
    // manifest version is exactly the case it exists for.
    const view = literalView({ 'vitest.config.ts': 'export default {};' });
    const detections = await probeToolchain(view, { versions: { vitest: 'file:local' } });
    expect(detectionFor(detections, 'vitest')?.version).toBe('file:local');
  });
});
