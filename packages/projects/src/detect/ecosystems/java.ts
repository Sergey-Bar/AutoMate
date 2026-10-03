import { evidenceFor, xmlArtifactIds } from '../manifest.js';
import type { EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

/**
 * Maven's `surefire` runs unit tests and `failsafe` runs integration tests, in
 * different lifecycle phases and different plugin goals. Conflating them is the
 * defect the copilot's first capability is named for — "your `pom.xml` runs
 * surefire, not failsafe; integration tests are being collected as unit tests" —
 * so they are two distinct signals here, not one.
 */
const JAVA_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['junit', 'unit'],
  ['junit-jupiter', 'unit'],
  ['surefire', 'unit'],
  ['failsafe', 'integration'],
  ['testng', 'unit'],
  ['jacoco', 'unit'],
  ['gatling', 'performance'],
  ['owasp-dependency-check', 'security'],
  ['zaproxy', 'security'],
];

const JAVA_COVERAGE_GLOBS = [{ glob: '**/site/jacoco/jacoco.xml', format: 'jacoco-xml' }] as const;

const JAVA_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/target/surefire-reports/*.xml', format: 'junit-xml', category: 'unit' },
  { glob: '**/target/failsafe-reports/*.xml', format: 'junit-xml', category: 'integration' },
  { glob: '**/build/test-results/**/*.xml', format: 'junit-xml', category: 'unit' },
];

const JAVA_COVERAGE_FORMATS = ['jacoco-xml', 'cobertura'] as const;

/**
 * Maven before Gradle.
 *
 * Two build systems in one repository is a real state — a Maven project with a
 * `build.gradle` for a submodule — but the two need different commands, and
 * proposing only one of them would hide half the evidence. So both are proposed
 * when both are present.
 */
/**
 * What to call this repository's build system.
 *
 * Two build files means the answer is genuinely two-sided, and naming one of them is
 * a claim the repository contradicts — `spring-petclinic` ships both a `pom.xml` and
 * a `build.gradle` — so the honest string counts them. The command list below
 * proposes both, and a screen that said "maven" while offering two commands would be
 * telling the reader something the repository does not say.
 *
 * Its own function because it was a nested ternary inside an object literal, and a
 * nested ternary in a returned object is unreadable *and* is exactly the shape the
 * complexity ceiling refuses.
 */
function describeBuildSystem(files: readonly string[], texts: ReadonlyMap<string, string>): string {
  if (files.length > 1) return `${files.length} build files`;
  return texts.has('pom.xml') ? 'maven' : 'gradle';
}

function javaCommands(
  texts: ReadonlyMap<string, string>,
  mvn: string,
  gradle: string,
): CommandCandidate[] {
  const commands: CommandCandidate[] = [];
  if (texts.has('pom.xml')) {
    // `verify`, not `test`: `mvn test` stops before `failsafe`, so an integration
    // suite configured in the POM would never run and the score would report a
    // category the repository cannot actually execute.
    commands.push({
      id: 'java.maven',
      argv: [mvn, 'verify'],
      label: `${mvn} verify`,
      category: 'integration',
      evidence: 'pom.xml',
      confidence: 0.8,
    });
  }
  if (texts.has('build.gradle') || texts.has('build.gradle.kts')) {
    const file = texts.has('build.gradle') ? 'build.gradle' : 'build.gradle.kts';
    commands.push({
      id: 'java.gradle',
      argv: [gradle, 'test'],
      label: `${gradle} test`,
      category: 'unit',
      evidence: file,
      confidence: 0.8,
    });
  }
  return commands;
}

export const detectJava: EcosystemDetector = async ({ paths, read }) => {
  const files = ['pom.xml', 'build.gradle', 'build.gradle.kts'].filter((file) =>
    paths.includes(file),
  );
  if (files.length === 0) return null;

  const texts = new Map<string, string>();
  for (const file of files) {
    const body = await read(file);
    if (body !== null) texts.set(file, body);
  }
  if (texts.size === 0) return null;

  const frameworks: FrameworkSignal[] = [];
  for (const [name, category] of JAVA_FRAMEWORKS) {
    for (const [file, body] of texts) {
      if (!xmlArtifactIds(body).has(name) && !body.includes(name)) continue;
      frameworks.push({ name, category, evidence: evidenceFor(file, body, name) });
      break;
    }
  }

  // **Dogfooded against `spring-projects/spring-petclinic`, which ships both a
  // `pom.xml` and a `build.gradle`, and both `mvnw` and `gradlew`.**
  //
  // Proposing bare `mvn` and bare `gradlew` told the operator to run whatever build
  // tool happened to be on their `PATH`, which is a different build tool from the
  // one the repository pins. A wrapper is the version the repository declares, so it
  // is the command to propose whenever the repository ships one — and the detector
  // reads only root-level paths, so `./gradlew` cannot be a wrapper for a Gradle
  // module three directories down.
  const mvn = paths.includes('mvnw') ? './mvnw' : 'mvn';
  const gradle = paths.includes('gradlew') ? './gradlew' : 'gradle';

  return {
    ecosystem: 'java',
    language: 'Java',
    // Both build files means the answer is genuinely two-sided, and naming one of
    // them is a claim the repository contradicts. The command list proposes both,
    // and this string names the one that appears first in the build-file order the
    // detector already fixed — which is the same tie-break, applied to one field.
    packageManager: describeBuildSystem(files, texts),
    frameworks,
    candidateCommands: javaCommands(texts, mvn, gradle),
    artifactGlobs: [...JAVA_ARTIFACTS],
    // JaCoCo writes to `build/reports/jacoco` for Gradle and `target/site/jacoco`
    // for Maven. Both are declared because **this** detector cannot tell which build
    // file a repository honours, and a glob that matches nothing costs a command a
    // result.
    coverageGlobs: [...JAVA_COVERAGE_GLOBS],

    coverageFormats: [...JAVA_COVERAGE_FORMATS],
    confidence: 0.85,
  };
};
