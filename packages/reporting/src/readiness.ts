import type { DigestItem, ReadinessReason, ReleaseReadinessCard } from '@automate/shared-contracts';

/**
 * Release readiness: one go / caution / no-go answer per project, and every reason for it.
 *
 * ## The one authority for the verdict
 *
 * The API gathers the inputs and the dashboard renders the card; neither decides. A
 * second place that turned "the gate failed" into a colour would be a second policy, and
 * the two would disagree the first time somebody tuned one threshold.
 *
 * ## A missing input is `unknown`, and `unknown` is never a go
 *
 * A project with no gate result, no runs or no coverage report has not *passed* those
 * checks; nobody has looked. Each missing input is its own reason at level `unknown`, and
 * the verdict is `caution` — so the card says what evidence is missing rather than printing
 * a green "go" over an empty room.
 */
export interface ReadinessInput {
  projectId: string;
  evaluatedAt: string;
  /** Runs in the window, for this project. */
  runs: number;
  /** The latest gate evaluation for the project, or `null` when none ran. */
  gate: { status: string; runId: string } | null;
  passRate: number | null;
  passRateThreshold: number;
  /** Flaky tests as a percentage of executed tests in the window. */
  flakyRate: number | null;
  /** The gate's own `maxFlakyRate`, so the card and the gate use one number. */
  maxFlakyRate: number;
  coverage: { current: number | null; delta: number | null };
  openQuarantine: number;
}

/** Below this the release is a no-go regardless of the threshold: one in five runs fails. */
const PASS_RATE_FLOOR = 80;
/** A fall smaller than this is noise in a mean over many reports. */
const COVERAGE_NOISE = 0.5;

const ORDER = { 'no-go': 0, caution: 1, unknown: 2, go: 3 } as const;

export function evaluateReadiness(input: ReadinessInput): ReleaseReadinessCard {
  const reasons = [
    gateReason(input),
    passRateReason(input),
    flakyReason(input),
    coverageReason(input),
    quarantineReason(input),
    activityReason(input),
  ]
    // Stable: within a level the reasons keep the order above, which is their importance.
    .map((reason, index) => ({ reason, index }))
    .sort(
      (left, right) =>
        ORDER[left.reason.level] - ORDER[right.reason.level] || left.index - right.index,
    )
    .map(({ reason }) => reason);
  const levels = new Set(reasons.map((reason) => reason.level));
  const verdict = levels.has('no-go')
    ? 'no-go'
    : levels.has('caution') || levels.has('unknown')
      ? 'caution'
      : 'go';
  return { projectId: input.projectId, verdict, reasons, evaluatedAt: input.evaluatedAt };
}

function pct(value: number): string {
  return `${String(Math.round(value * 10) / 10)}%`;
}

function gateReason({ gate }: ReadinessInput): ReadinessReason {
  if (gate === null) {
    return {
      code: 'gate',
      level: 'unknown',
      message: 'No quality gate has evaluated a run yet',
      evidence: 'no gate evaluation in the window',
    };
  }
  const level = gate.status === 'passed' ? 'go' : gate.status === 'failed' ? 'no-go' : 'caution';
  const message =
    level === 'go'
      ? 'The latest quality gate passed'
      : level === 'no-go'
        ? 'The latest quality gate failed'
        : `The latest quality gate is ${gate.status.replace('_', ' ')}`;
  return { code: 'gate', level, message, evidence: `run ${gate.runId}` };
}

function passRateReason({ passRate, passRateThreshold }: ReadinessInput): ReadinessReason {
  if (passRate === null) {
    return {
      code: 'pass-rate',
      level: 'unknown',
      message: 'No run in the window reached a verdict',
      evidence: 'pass rate unavailable',
    };
  }
  const level =
    passRate < PASS_RATE_FLOOR ? 'no-go' : passRate < passRateThreshold ? 'caution' : 'go';
  return {
    code: 'pass-rate',
    level,
    message:
      level === 'go'
        ? `Pass rate ${pct(passRate)} meets the ${pct(passRateThreshold)} threshold`
        : `Pass rate ${pct(passRate)} is below the ${pct(level === 'no-go' ? PASS_RATE_FLOOR : passRateThreshold)} ${level === 'no-go' ? 'floor' : 'threshold'}`,
    evidence: `pass rate over the window's runs with a verdict`,
  };
}

function flakyReason({ flakyRate, maxFlakyRate }: ReadinessInput): ReadinessReason {
  if (flakyRate === null) {
    return {
      code: 'flaky',
      level: 'unknown',
      message: 'No tests executed in the window',
      evidence: 'flaky rate unavailable',
    };
  }
  const over = flakyRate > maxFlakyRate;
  return {
    code: 'flaky',
    level: over ? 'caution' : 'go',
    message: over
      ? `${pct(flakyRate)} of tests were flaky; the gate allows ${pct(maxFlakyRate)}`
      : `Flaky tests within the gate (${pct(flakyRate)})`,
    evidence: 'flaky results over executed tests in the window',
  };
}

function coverageReason({ coverage }: ReadinessInput): ReadinessReason {
  if (coverage.current === null) {
    return {
      code: 'coverage',
      level: 'unknown',
      message: 'No coverage report was found on disk',
      evidence: 'no coverage report',
    };
  }
  const current = coverage.current.toFixed(1);
  if (coverage.delta === null) {
    return {
      code: 'coverage',
      level: 'go',
      message: `Coverage is ${current}%, with no earlier reading to compare`,
      evidence: 'mean line coverage over the reports on disk',
    };
  }
  const falling = coverage.delta < -COVERAGE_NOISE;
  return {
    code: 'coverage',
    level: falling ? 'caution' : 'go',
    message: falling
      ? `Coverage fell ${Math.abs(coverage.delta).toFixed(1)} pts to ${current}%`
      : `Coverage holds at ${current}%`,
    evidence: 'mean line coverage, against the first reading in the window',
  };
}

function quarantineReason({ openQuarantine }: ReadinessInput): ReadinessReason {
  return {
    code: 'quarantine',
    level: openQuarantine > 0 ? 'caution' : 'go',
    message:
      openQuarantine > 0
        ? `${String(openQuarantine)} quarantined test${openQuarantine === 1 ? '' : 's'} await a decision`
        : 'Nothing is waiting in quarantine',
    evidence: 'pending quarantine entries',
  };
}

function activityReason({ runs }: ReadinessInput): ReadinessReason {
  return runs === 0
    ? {
        code: 'activity',
        level: 'unknown',
        message: 'No runs in the window',
        evidence: 'the readiness window is empty',
      }
    : {
        code: 'activity',
        level: 'go',
        message: `${String(runs)} run${runs === 1 ? '' : 's'} in the window`,
        evidence: 'runs for this project',
      };
}

/** One window's worth of the digest's inputs. */
export interface DigestWindow {
  runs: number;
  passRate: number | null;
  /** Keys of tests the window found flaky. */
  flakyKeys: readonly string[];
  /** Keys of tests that failed at least once in the window. */
  failingKeys: readonly string[];
}

export interface DigestInput {
  current: DigestWindow & {
    /** Tests whose median grew, worst first, already filtered to a real change. */
    slowKeys: ReadonlyArray<{ key: string; title: string; changePct: number }>;
  };
  previous: DigestWindow;
  coverageDelta: number | null;
}

/** Below this a change in a percentage is noise rather than news. */
const PASS_RATE_NOISE = 0.5;

/**
 * "What changed since last week", as a short list of sentences, worst news first.
 *
 * Only what moved: an unchanged pass rate is not a line. A digest that restates every
 * number every week is a report nobody reads by the third week.
 */
export function buildDigest(input: DigestInput): DigestItem[] {
  const flaky = flakyNews(input);
  const change = changeNews(input);
  return [...flaky.bad, ...change.bad, ...change.good, ...flaky.good, ...runNews(input)];
}

interface News {
  bad: DigestItem[];
  good: DigestItem[];
}

/** New flaky and newly failing tests (bad), and flaky tests that stopped flipping (good). */
function flakyNews(input: DigestInput): News {
  const previousFlaky = new Set(input.previous.flakyKeys);
  const currentFlaky = new Set(input.current.flakyKeys);
  const newFlaky = input.current.flakyKeys.filter((key) => !previousFlaky.has(key)).length;
  const fixedFlaky = input.previous.flakyKeys.filter((key) => !currentFlaky.has(key)).length;
  const previousFailing = new Set(input.previous.failingKeys);
  const newFailures = input.current.failingKeys.filter((key) => !previousFailing.has(key)).length;
  const bad: DigestItem[] = [];
  if (newFlaky > 0) {
    bad.push({ kind: 'new-flaky', tone: 'bad', text: plural(newFlaky, 'new flaky test') });
  }
  // With no earlier window every failure is "new", which says nothing.
  if (newFailures > 0 && input.previous.runs > 0) {
    bad.push({ kind: 'new-failure', tone: 'bad', text: plural(newFailures, 'newly failing test') });
  }
  const good: DigestItem[] =
    fixedFlaky > 0
      ? [{ kind: 'new-flaky', tone: 'good', text: `${plural(fixedFlaky, 'flaky test')} fixed` }]
      : [];
  return { bad, good };
}

/** Moves in pass rate and coverage, then the test that slowed most. */
function changeNews(input: DigestInput): News {
  const news: News = { bad: [], good: [] };
  const record = (kind: 'pass-rate' | 'coverage', label: string, change: number): void => {
    const tone = change > 0 ? 'good' : 'bad';
    news[tone].push({ kind, tone, text: `${label} ${signed(change)} pts` });
  };
  const { passRate } = input.current;
  const before = input.previous.passRate;
  if (passRate !== null && before !== null && Math.abs(passRate - before) >= PASS_RATE_NOISE) {
    record('pass-rate', 'Pass rate', passRate - before);
  }
  if (input.coverageDelta !== null && Math.abs(input.coverageDelta) >= 0.1) {
    record('coverage', 'Coverage', input.coverageDelta);
  }
  const [slowest] = input.current.slowKeys;
  if (slowest !== undefined) {
    news.bad.push({
      kind: 'newly-slow',
      tone: 'bad',
      text: `${slowest.title} is ${String(Math.round(slowest.changePct))}% slower`,
    });
  }
  return news;
}

function runNews({ current, previous }: DigestInput): DigestItem[] {
  if (current.runs === previous.runs || previous.runs === 0) return [];
  const direction = current.runs > previous.runs ? 'up' : 'down';
  return [
    {
      kind: 'runs',
      tone: 'neutral',
      text: `${String(current.runs)} runs, ${direction} from ${String(previous.runs)}`,
    },
  ];
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** A signed figure with a true minus sign, so "−4.0" never reads as a hyphenated range. */
function signed(value: number): string {
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
}
