import { evidenceFor } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

const RUST_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['insta', 'unit'],
  ['proptest', 'unit'],
  ['rstest', 'integration'],
  ['tokio', 'integration'],
  ['playwright', 'e2e'],
  ['criterion', 'performance'],
  ['cargo-deny', 'security'],
];

const RUST_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/junit*.xml', format: 'junit-xml', category: 'unit' },
];

const RUST_COVERAGE_FORMATS = ['llvm-cov'] as const;

export const detectRust: EcosystemDetector = async ({ paths, read }) => {
  if (!paths.includes('Cargo.toml')) return null;
  const text = await read('Cargo.toml');
  if (text === null) return null;

  const frameworks = RUST_FRAMEWORKS.filter(([name]) => text.includes(name)).map(
    ([name, category]) => ({ name, category, evidence: evidenceFor('Cargo.toml', text, name) }),
  );
  // `cargo nextest` cannot be assumed installed, so it is proposed only when
  // `Cargo.toml` asks for it — as a `[dev-dependencies]` entry, which is the only
  // place a Rust repository states it uses nextest.
  const usesNextest = /\bnextest\b/.test(text);

  return {
    ecosystem: 'rust',
    language: 'Rust',
    packageManager: 'cargo',
    // `libtest` is the standard harness every Rust binary carries, so a
    // `Cargo.toml` with no test dependency is still a repository that can run
    // tests. Without it a bare Rust project would report zero framework signals
    // and a category the operator has to fill in by hand.
    frameworks: [
      {
        name: 'libtest',
        category: 'unit',
        evidence: evidenceFor('Cargo.toml', text, '[package]'),
      },
      ...frameworks,
    ],
    candidateCommands: rustCommands(usesNextest),
    artifactGlobs: [...RUST_ARTIFACTS],
    coverageGlobs: [],
    coverageFormats: [...RUST_COVERAGE_FORMATS],
    confidence: 0.85,
  };
};

/**
 * `cargo test` first, `cargo llvm-cov` second.
 *
 * The coverage candidate is separate because `llvm-cov` is a `cargo install`
 * away and not usually present, and a command the operator cannot run is worse
 * than one they can. Both are proposed, ranked, and overridable.
 */
function rustCommands(usesNextest: boolean): CommandCandidate[] {
  const commands: CommandCandidate[] = [
    {
      id: 'rust.cargo-test',
      argv: ['cargo', 'test'],
      label: 'cargo test',
      category: categoryForScriptName('test'),
      evidence: 'Cargo.toml',
      confidence: 0.9,
    },
    {
      id: 'rust.llvm-cov',
      argv: ['cargo', 'llvm-cov', '--all-features', '--workspace'],
      label: 'cargo llvm-cov --all-features --workspace',
      category: 'unit',
      evidence: 'Cargo.toml',
      confidence: 0.55,
    },
  ];
  if (usesNextest) {
    commands.unshift({
      id: 'rust.nextest',
      argv: ['cargo', 'nextest', 'run'],
      label: 'cargo nextest run',
      category: 'unit',
      evidence: 'Cargo.toml',
      confidence: 0.85,
    });
  }
  return commands;
}
