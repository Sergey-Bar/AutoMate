import type { ManifestRoute } from './route-manifest.js';

export interface PageGuidance {
  purpose: string;
  steps: readonly [string, string, string];
  remember: string;
}

/** Teaching copy follows the route manifest, including detail screens. */
export const pageGuidance = {
  now: {
    purpose: 'Start here to see what needs attention across your quality signals.',
    steps: [
      'Read the current summary.',
      'Open the highest-priority item.',
      'Inspect the evidence before deciding what to do.',
    ],
    remember: 'A missing signal means there is not enough evidence to judge it.',
  },
  portfolio: {
    purpose: 'Compare the repositories you work on and choose one to investigate.',
    steps: [
      'Find your repository.',
      'Read its grade and the reason behind it.',
      'Open its details to inspect the limiting findings.',
    ],
    remember: 'Compare measured dimensions. An incomplete grade is not a clean bill of health.',
  },
  dashboard: {
    purpose: 'Understand the quality picture for one project.',
    steps: [
      'Confirm which project you are viewing.',
      'Look for failures and unmeasured areas.',
      'Open a finding or run to see its source.',
    ],
    remember: 'A summary is a starting point. The linked evidence explains the result.',
  },
  'repo-health': {
    purpose: 'Find what limits a repository’s health grade.',
    steps: [
      'Read the grade and its limiter.',
      'Inspect the affected dimension.',
      'Review its findings and source reports.',
    ],
    remember: 'An unmeasured dimension is missing information, not a zero or a pass.',
  },
  'repo-360': {
    purpose: 'Read the available quality signals for one repository together.',
    steps: [
      'Confirm the repository and scope.',
      'Identify weak or missing signals.',
      'Follow a signal to its underlying evidence.',
    ],
    remember: 'Different signals describe different parts of quality; read their context.',
  },
  runs: {
    purpose: 'Find a test run and understand what happened.',
    steps: [
      'Choose the run you want to inspect.',
      'Read its phase and outcome.',
      'Open the run for tests, retries and artifacts.',
    ],
    remember: 'Phase tells you where the run is. Outcome tells you what happened.',
  },
  'run-detail': {
    purpose: 'Investigate one run using its tests and retained evidence.',
    steps: [
      'Check the run’s identity and outcome.',
      'Inspect failed or retried tests.',
      'Read the artifacts and quality-gate verdict.',
    ],
    remember: 'A retry that passes can still produce a flaky test status.',
  },
  runner: {
    purpose: 'Choose a tool and prepare the work you want it to run.',
    steps: [
      'Choose the tool or capability.',
      'Read its requirements and enter the target.',
      'Launch it and inspect the resulting output.',
    ],
    remember: 'A tool being listed does not mean it is configured on this installation.',
  },
  insights: {
    purpose: 'Find recurring test problems instead of treating each failure alone.',
    steps: [
      'Choose the project and scope.',
      'Look for repeated failures or unstable tests.',
      'Open the history or evidence behind the pattern.',
    ],
    remember: 'A pattern is useful when you can trace it back to individual runs.',
  },
  analytics: {
    purpose: 'See how test quality changes over time.',
    steps: [
      'Choose a relevant time range.',
      'Compare rates and volumes together.',
      'Investigate the runs behind a change.',
    ],
    remember: 'A percentage based on a small sample can change sharply.',
  },
  quarantine: {
    purpose: 'Review proposals to exclude known-unstable tests from consideration.',
    steps: [
      'Read the test and the recorded reason.',
      'Review the evidence before deciding.',
      'Record the resolution and check the final state.',
    ],
    remember: 'Pending entries still count. Approved and rejected decisions are final.',
  },
  'test-history': {
    purpose: 'Follow the same test across its recorded runs.',
    steps: [
      'Confirm the test identity.',
      'Compare failures, passes and retries.',
      'Open a run that explains the change.',
    ],
    remember: 'A test’s history gives context that its latest result alone cannot.',
  },
  delivery: {
    purpose: 'Understand delivery performance using deployments and pull-request flow.',
    steps: [
      'Confirm the project and reporting window.',
      'Read each metric with its sample size.',
      'Investigate the deployments or changes behind it.',
    ],
    remember: 'Missing deployment data limits what delivery metrics can tell you.',
  },
  'ai-code': {
    purpose: 'Review attributed AI-written changes and their measured outcomes.',
    steps: [
      'Read attribution and confidence.',
      'Compare outcomes for the available changes.',
      'Check the evidence before drawing conclusions.',
    ],
    remember: 'Attribution is a signal with confidence, not proof of who wrote every line.',
  },
  agents: {
    purpose: 'Inspect the eval, runtime and configuration evidence available for agents.',
    steps: [
      'Choose the project and signal.',
      'Read failures, regressions or budget results.',
      'Inspect the source evidence and policy.',
    ],
    remember: 'These signals are opt-in; an absent signal was not necessarily measured.',
  },
  score: {
    purpose: 'Understand the components behind a project’s quality score.',
    steps: [
      'Read the overall score.',
      'Find the weakest measured component.',
      'Open the evidence that explains it.',
    ],
    remember: 'Use the component evidence to choose the next improvement.',
  },
  gaps: {
    purpose: 'Identify areas where automation coverage may be missing.',
    steps: [
      'Review the reported gaps.',
      'Inspect the context for each gap.',
      'Choose what needs additional test coverage.',
    ],
    remember: 'A gap is a prompt to investigate, not proof that a test is useful or sufficient.',
  },
  hollow: {
    purpose: 'Inspect tests flagged for weak or missing assertions.',
    steps: [
      'Choose a reported test.',
      'Read why it was flagged.',
      'Review its assertions before changing it.',
    ],
    remember: 'A passing test can still fail to verify meaningful behavior.',
  },
  flaky: {
    purpose: 'Investigate tests whose outcomes vary or require retries.',
    steps: [
      'Find an unstable test.',
      'Compare its recorded attempts.',
      'Use the failure evidence to plan a fix.',
    ],
    remember: 'Passing on retry preserves the earlier failure as part of the evidence.',
  },
  structure: {
    purpose: 'Review structural findings about the project’s tests.',
    steps: [
      'Read the finding category.',
      'Inspect its location and explanation.',
      'Decide whether the structure needs changing.',
    ],
    remember: 'Review each finding in the context of the repository.',
  },
  map: {
    purpose: 'Find where a capability lives in the platform.',
    steps: [
      'Choose the area you need.',
      'Read the available capabilities.',
      'Open the relevant tool or page.',
    ],
    remember: 'Use Capabilities to check what this installation can actually execute.',
  },
  health: {
    purpose: 'Check which capabilities are available on this installation.',
    steps: [
      'Find the capability you need.',
      'Read its current status and requirements.',
      'Resolve missing setup before expecting a result.',
    ],
    remember: 'Not configured is different from a failed test.',
  },
  'supply-chain': {
    purpose: 'Inspect evidence about dependencies and software supply-chain controls.',
    steps: [
      'Choose the repository.',
      'Review the supplied reports and findings.',
      'Inspect a finding’s source before acting.',
    ],
    remember: 'No uploaded report means no measurement for that signal.',
  },
  toolbox: {
    purpose: 'Discover the tools available for different kinds of quality checks.',
    steps: [
      'Find the kind of check you need.',
      'Read the tool’s requirements.',
      'Open its runner or documentation.',
    ],
    remember: 'Choose a tool based on the question you want to answer.',
  },
  access: {
    purpose: 'Manage how people, devices and CI connect to the installation.',
    steps: [
      'Identify who or what needs access.',
      'Choose the appropriate role or pairing flow.',
      'Check the resulting access and keep credentials private.',
    ],
    remember: 'Access changes require the appropriate role. Use the smallest role needed.',
  },
  members: {
    purpose: 'See who signed in with single sign-on, and set what each person may do here.',
    steps: [
      'Find the person by name or email.',
      'Choose their role, or disable them to sign them out everywhere at once.',
      'Remove someone who should no longer have a role in this workspace.',
    ],
    remember:
      'The last admin cannot be demoted or removed, and a role map in your identity provider applies again at the next sign-in.',
  },
  audit: {
    purpose: 'Check that the audit trail is intact, read recent decisions, and export it.',
    steps: [
      'Read whether the chain is intact, and which rows are not.',
      'Scan the newest events: who did what, and from where.',
      'Export NDJSON or CSV, and keep the head hash beside the export.',
    ],
    remember:
      'The trail cannot be edited. A recorded head is what proves later it was not rewritten.',
  },
  deployment: {
    purpose: 'Understand the active deployment profile and its next setup steps.',
    steps: [
      'Read the current profile.',
      'Check how users reach and sign in to the installation.',
      'Follow the setup guidance for the intended audience.',
    ],
    remember:
      'The deployment profile controls access defaults; read them before changing profiles.',
  },
  reports: {
    purpose: 'Deliver a short quality summary on a schedule.',
    steps: [
      'Choose a delivery channel.',
      'Set the schedule and timezone.',
      'Send a test and inspect delivery history.',
    ],
    remember: 'Channel management needs admin access; scheduling needs operator access.',
  },
  pair: {
    purpose: 'Connect this device using the installation’s pairing flow.',
    steps: [
      'Confirm you are connecting to the intended installation.',
      'Follow the pairing instructions shown.',
      'Check that the device has the intended access.',
    ],
    remember: 'Pair only devices you intend to authorize.',
  },
} satisfies Record<ManifestRoute['id'], PageGuidance>;
