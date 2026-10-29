export interface Journey {
  audience: string;
  goal: string;
  stages: readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ];
  takeaway: string;
}

export const pageJourneys: Record<string, Journey> = {
  'guide/glossary.md': {
    audience: 'Anyone learning the product',
    goal: 'Turn an unfamiliar word into something you can recognize on screen.',
    stages: [
      ['Find the word', 'Look for the term you saw in a screen, report or guide.'],
      ['Read an example', 'Connect the definition to a concrete test or release scenario.'],
      [
        'Try the scenario',
        'Use the retry example below to see the difference between passing and flaky.',
      ],
    ],
    takeaway: 'You can return here at any point; the guides do not require memorizing these terms.',
  },
  'guide/install.md': {
    audience: 'First-time users · administrators',
    goal: 'Get from a downloaded release to a running installation.',
    stages: [
      ['Prepare', 'Install Docker with Compose v2 and download the release bundle.'],
      ['Start', 'Unpack the release and run the start script for your operating system.'],
      ['Verify', 'Open the console. Use status and logs if the stack is not ready.'],
    ],
    takeaway: 'Keep the generated .env file: it contains the secrets this installation needs.',
  },
  'guide/getting-started.md': {
    audience: 'Developers working on Automate',
    goal: 'Run the source tree and know which checks to run before contributing.',
    stages: [
      [
        'Prepare the source',
        'Use the repository’s required Node and pnpm versions and install dependencies.',
      ],
      ['Choose a stack', 'Follow the local development path or the full-stack setup below.'],
      ['Verify your change', 'Run the relevant checks before opening a pull request.'],
    ],
    takeaway: 'Want to use Automate rather than develop it? Follow the Install guide.',
  },
  'guide/profiles.md': {
    audience: 'Individuals · team owners · administrators',
    goal: 'Choose defaults that match who will use your installation.',
    stages: [
      [
        'Identify your users',
        'Solo is for one local operator. Startup, team and enterprise serve shared installations.',
      ],
      [
        'Choose access',
        'Decide whether users connect locally, over a network or through a remote entry point.',
      ],
      [
        'Configure sign-in',
        'Follow the profile’s authentication requirements and review the Deployment page.',
      ],
    ],
    takeaway:
      'Changing profiles keeps data and secrets, but changes the access defaults you must understand.',
  },
  'guide/repository-health.md': {
    audience: 'Developers · QA · team leads',
    goal: 'Turn a repository grade into a concrete improvement.',
    stages: [
      ['Bring evidence', 'Upload reports from the scanners and test tools you already run.'],
      ['Read the limiter', 'The grade names the dimension or hard gate holding it back.'],
      ['Inspect the finding', 'Open the source finding and decide what to fix or triage.'],
    ],
    takeaway:
      'No measurement means no score for that dimension. An incomplete repository gets no letter.',
  },
  'guide/delivery-performance.md': {
    audience: 'Engineering leads · developers',
    goal: 'Connect delivery events to metrics you can explain.',
    stages: [
      ['Connect a source', 'Sync GitHub data or push deployment and incident events from CI.'],
      ['Read the scorecard', 'Inspect delivery and pull-request flow for the selected window.'],
      ['Check the context', 'Read sample sizes and policy before using the metric in a gate.'],
    ],
    takeaway: 'A missing event source limits the conclusions a delivery scorecard can support.',
  },
  'guide/ai-code.md': {
    audience: 'Engineering leads · reviewers',
    goal: 'Understand attributed AI-written changes and their outcomes.',
    stages: [
      ['Read attribution', 'Look at the signals and their confidence for the change.'],
      ['Compare outcomes', 'Read the measured quality outcomes and the available sample.'],
      ['Apply policy', 'Use the governance settings only after understanding what was measured.'],
    ],
    takeaway: 'Attribution is evidence with confidence, not proof of the author of every line.',
  },
  'guide/agents.md': {
    audience: 'Agent builders · platform teams',
    goal: 'Understand which agent-quality signals you have and what they mean.',
    stages: [
      ['Choose a signal', 'Start with evals, traces, runtime budgets or configuration scans.'],
      ['Connect evidence', 'Follow the relevant upload or integration instructions below.'],
      ['Read the policy', 'Compare measured behavior against the configured baseline or budget.'],
    ],
    takeaway: 'Signals are opt-in. Prompt and trace content are not stored by default.',
  },
  'guide/issues-and-test-proposals.md': {
    audience: 'QA · developers · triage owners',
    goal: 'Turn a measured problem into work someone can review.',
    stages: [
      [
        'Pick evidence',
        'Start from a finding, failure cluster, surviving mutant or uncovered changed lines.',
      ],
      [
        'Choose an action',
        'Create a linked issue or request a test proposal through the configured integration.',
      ],
      ['Review the result', 'Read the issue context or proposed patch before acting on it.'],
    ],
    takeaway:
      'A test proposal is a patch for a person to review. Automate does not apply it to the repository.',
  },
  'guide/cli.md': {
    audience: 'Developers · CI owners',
    goal: 'Make your CI reports part of the same quality record.',
    stages: [
      ['Configure', 'Set the installation address and the appropriate upload credential.'],
      [
        'Choose a command',
        'Upload a report, evaluate a gate or record a deployment using the examples.',
      ],
      [
        'Read the exit code',
        'Use the command’s documented result to decide how CI should proceed.',
      ],
    ],
    takeaway:
      'An upload and a gate answer different questions: stored evidence does not automatically mean a passing policy.',
  },
  'guide/mcp.md': {
    audience: 'Developers using an AI editor',
    goal: 'Ask your editor questions about recorded quality evidence.',
    stages: [
      ['Create access', 'Use the read-only access described in the token section.'],
      [
        'Connect the editor',
        'Choose HTTP or the stdio proxy and follow your editor’s configuration example.',
      ],
      ['Ask a question', 'Use the available tools to retrieve evidence from the installation.'],
    ],
    takeaway: 'This MCP interface is read-only. It does not launch runs or modify your project.',
  },
  'guide/lan-mode.md': {
    audience: 'Administrators · local teams',
    goal: 'Let trusted devices reach a shared installation on your network.',
    stages: [
      ['Configure the server', 'Follow the LAN setup for the release you installed.'],
      ['Connect a device', 'Trust the certificate and use the documented sign-in or pairing flow.'],
      [
        'Verify reachability',
        'Check the hostname, firewall and connection from the intended device.',
      ],
    ],
    takeaway:
      'Each device needs the certificate trust step. A local-only profile is not a shared-network setup.',
  },
  'guide/remote-cloudflare.md': {
    audience: 'Administrators · remote teams',
    goal: 'Understand the path from a remote user to your installation.',
    stages: [
      ['Prepare', 'Review the Cloudflare and installation prerequisites.'],
      ['Connect', 'Configure Tunnel and Access using the setup below.'],
      ['Map roles', 'Decide which users and CI clients receive which roles, then verify access.'],
    ],
    takeaway:
      'Read the tested boundaries at the end of this guide before treating the setup as verified for your environment.',
  },
  'guide/operations-enterprise.md': {
    audience: 'Administrators · platform teams',
    goal: 'Run one installation for several teams, and be able to rebuild it from a backup.',
    stages: [
      ['Admit people', 'Enforce single sign-on, connect SCIM and give each team a workspace.'],
      ['Protect the data', 'Schedule backups, copy them off the host and rehearse a restore.'],
      ['Watch and prove', 'Send request traces to your collector and file the audit head hash.'],
    ],
    takeaway:
      'One host, by design: a host outage is an outage, and recovery is a restore on another.',
  },
  'guide/notifications.md': {
    audience: 'Team leads · operators · administrators',
    goal: 'Deliver a short quality summary where your team reads it.',
    stages: [
      ['Where', 'Start with the Automate inbox or configure a supported delivery channel.'],
      ['When', 'Choose a schedule and verify its timezone.'],
      ['Did it arrive?', 'Send a test and inspect the delivery history for success or an error.'],
    ],
    takeaway:
      'Admins manage channel credentials; operators schedule reports; viewers can read history.',
  },
  'guide/compare.md': {
    audience: 'Evaluators · team leads',
    goal: 'Decide whether Automate fits the workflow you need.',
    stages: [
      ['Name your need', 'Start with the quality question you want the product to answer.'],
      ['Compare categories', 'Read the supported workflows and their stated boundaries.'],
      [
        'Check evidence',
        'Use the verification section and capability register to distinguish built from planned.',
      ],
    ],
    takeaway:
      'Choose based on your workflow and verified capabilities, rather than a feature count.',
  },
  'guide/testing-strategy.md': {
    audience: 'Contributors · technical reviewers',
    goal: 'Understand what a passing repository check actually proves.',
    stages: [
      [
        'Choose the layer',
        'Match the behavior to unit, integration, contract or end-to-end evidence.',
      ],
      ['Run the gate', 'Use the required command and its real dependencies.'],
      [
        'Read the limits',
        'Check ratchets and not-configured results before calling the run clean.',
      ],
    ],
    takeaway: 'A tool that did not run has not produced a passing measurement.',
  },
  'guide/maintenance.md': {
    audience: 'Maintainers · contributors',
    goal: 'Keep fixes, dependencies and releases tied to reviewable evidence.',
    stages: [
      ['Record the issue', 'Use the findings ledger and preserve its evidence.'],
      ['Make the change', 'Follow dependency and review conventions for the affected area.'],
      ['Verify and release', 'Use the recurring checks and release process below.'],
    ],
    takeaway:
      'The ledger records confirmed status and proof; changing prose alone does not close a defect.',
  },
  'guide/design-language.md': {
    audience: 'Designers · frontend contributors',
    goal: 'Build a screen that speaks the same language as the rest of Automate.',
    stages: [
      ['Use the plane', 'Choose shared surface and border tokens rather than inventing a palette.'],
      ['Explain state', 'Use type, labels and status colors to make meaning clear.'],
      [
        'Check interaction',
        'Follow motion, dialog and reduced-motion rules before shipping the screen.',
      ],
    ],
    takeaway: 'The product and documentation import the same theme tokens.',
  },
  'architecture.md': {
    audience: 'Developers · operators',
    goal: 'Understand which part of the system owns each responsibility.',
    stages: [
      [
        'Follow the boundary',
        'Identify the API, execution and storage responsibilities in the architecture.',
      ],
      ['Trace the flow', 'Follow a request or run through the documented components.'],
      ['Inspect the contract', 'Use the linked source and decisions for implementation details.'],
    ],
    takeaway: 'Use the architecture to locate responsibility before changing a component.',
  },
  'operations.md': {
    audience: 'Operators · administrators',
    goal: 'Run and diagnose the installation using the documented procedures.',
    stages: [
      ['Check prerequisites', 'Confirm configuration, dependencies and access for the operation.'],
      [
        'Follow the procedure',
        'Use the commands and operational guidance in the relevant section.',
      ],
      ['Verify the result', 'Read health, logs and the documented recovery steps.'],
    ],
    takeaway: 'Keep operational secrets and persistent data in mind before making changes.',
  },
  'pages/index.md': {
    audience: 'Developers · operators · designers',
    goal: 'Find the reference that answers your implementation question.',
    stages: [
      ['Architecture', 'Find service boundaries and system responsibilities.'],
      ['Operations', 'Find setup, runtime and diagnostic procedures.'],
      ['Design language', 'Find the shared visual and interaction rules.'],
    ],
    takeaway:
      'Use the guided introduction first if you are learning the product for the first time.',
  },
  'pages/capabilities.md': {
    audience: 'Evaluators · users · contributors',
    goal: 'Read what is implemented and what remains planned.',
    stages: [
      ['Find a capability', 'Locate the workflow you want to use.'],
      ['Read its status', 'Distinguish real capabilities from planned or incomplete ones.'],
      ['Follow the evidence', 'Use the cited paths and checks to inspect the claim.'],
    ],
    takeaway:
      'The register is generated from repository evidence; this introduction does not change its statuses.',
  },
  'pages/quality/index.md': {
    audience: 'Evaluators · maintainers',
    goal: 'Read the repository’s measured quality state.',
    stages: [
      ['Choose a question', 'Use coverage, findings or the definition of done.'],
      ['Read the measurement', 'Look at the generated record and its scope.'],
      ['Inspect the evidence', 'Follow the sources behind the reported status.'],
    ],
    takeaway:
      'These pages describe repository quality evidence, not the results in your own installation.',
  },
  'pages/quality/coverage.md': {
    audience: 'Contributors · reviewers',
    goal: 'Understand which code is exercised by the recorded test coverage.',
    stages: [
      ['Read the scope', 'Find the package and coverage measurement.'],
      ['Compare dimensions', 'Inspect the available line, branch and function coverage.'],
      [
        'Investigate gaps',
        'Use the underlying test evidence to decide what behavior needs coverage.',
      ],
    ],
    takeaway:
      'Coverage measures execution. It does not by itself prove that assertions are useful.',
  },
  'pages/quality/findings.md': {
    audience: 'Maintainers · reviewers',
    goal: 'Find confirmed defects and understand their recorded status.',
    stages: [
      ['Read severity', 'Identify which findings need attention first.'],
      ['Read status', 'Distinguish open work, fixed evidence and recorded debt.'],
      ['Follow proof', 'Inspect the evidence behind a closure or refutation.'],
    ],
    takeaway:
      'This page is generated from the findings ledger; the ledger is the source of status.',
  },
  'pages/quality/ten.md': {
    audience: 'Evaluators · maintainers',
    goal: 'See how the repository measures its definition of done.',
    stages: [
      ['Read a criterion', 'Understand the condition the repository is trying to satisfy.'],
      ['Inspect its result', 'Read the generated measurement and any stated gap.'],
      ['Follow the check', 'Use the evidence behind that criterion to assess the claim.'],
    ],
    takeaway:
      'A completed check is evidence for that criterion, not a universal product quality rating.',
  },
};

export const bespokeJourneyPages = [
  'index.md',
  'he/index.md',
  'zh/index.md',
  'zht/index.md',
  'ko/index.md',
  'de/index.md',
  'es/index.md',
  'fr/index.md',
  'it/index.md',
  'da/index.md',
  'ja/index.md',
  'pl/index.md',
  'ru/index.md',
  'bs/index.md',
  'ar/index.md',
  'no/index.md',
  'br/index.md',
  'th/index.md',
  'tr/index.md',
  'uk/index.md',
  'bn/index.md',
  'gr/index.md',
  'vi/index.md',

  'guide/index.md',
  'guide/concepts.md',
  'guide/sending-results.md',
  'guide/quality-gates.md',
];
