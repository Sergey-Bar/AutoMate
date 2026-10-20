# AUTOMATE (local) — users and workflows

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

Who the product is for, what each of them is trying to get done, and what has to be true
for the first release to be worth their time. Everything about people here is a
`hypothesis`: no interviews have been held, and the evidence available is public product
documentation (see the [source register](./research/sources.md)). The validation plan at the
end is how these get tested.

## Primary persona for the first release

**P-3, the SDET or automation engineer responsible for a repository's test setup.** They
arrive with real repositories, several test tools, and reports already on disk. They feel
the cost of not knowing what the tests say, and they can judge whether the output is right.
The other personas are listed so the design does not exclude them, not to be served equally
at first.

## Personas

| ID  | Persona                                 | Primary job to be done                                                   | Most frequent workflow                                                        |
| --- | --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| P-1 | Manual QA engineer in an existing repo  | Find out what is automated and whether it passed, without reading code   | Opens a repository, looks for a report, asks a colleague which command to run |
| P-2 | Automation QA engineer (UI and API)     | See what failed and whether it is new, then fix or report it             | Runs a suite, opens the framework report, compares with the last run          |
| P-3 | SDET (frameworks, infrastructure)       | Keep several tools and reports trustworthy and consistent                | Maintains configs, reads CI artifacts, reconciles report formats              |
| P-4 | QA lead or senior QA                    | Judge overall quality and coverage and decide where to invest            | Asks for numbers, distrusts them, asks where each came from                   |
| P-5 | Developer who needs to understand tests | Learn how the tests of an unfamiliar repository work and how to run them | Reads package files and CI configs to find the test command                   |
| P-6 | Test architect across several tools     | Understand the balance of test layers and the gaps between them          | Reviews tooling across projects, compares layers, drafts strategy             |

| ID  | Current pain (hypothesis)                                       | Information needed first                                         | Decision it supports                                    | Likely adoption barrier                                     |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| P-1 | Cannot tell what exists or whether it ran                       | What tools exist; where the last results are; how fresh they are | Whether to trust a green run; what to ask a developer   | Anything that needs a terminal or configuration             |
| P-2 | Reports are per-tool and per-run; trends and newness are manual | Failures with their evidence; what changed since the last run    | Which failure to look at first                          | Another dashboard to feed                                   |
| P-3 | Report formats differ; shards and retries make totals unclear   | Completeness, duplicates, contradictions, parse problems         | Whether a number can be believed; which tool misreports | Distrust of a tool that hides its reasoning                 |
| P-4 | Numbers arrive without denominators or provenance               | Every figure with its source, denominator and freshness          | Where coverage or reliability is genuinely weak         | Fear of false confidence; a tool that rounds up             |
| P-5 | The test command and report location are tribal knowledge       | Detected frameworks, commands and report paths, with evidence    | How to run tests; where to add one                      | Not wanting to learn another framework's tooling            |
| P-6 | No single view across tools and layers                          | Test layers present, tools per layer, gaps                       | Which layer or tool to add or retire                    | Needs several repositories and mixed languages to be useful |

**Not assumed:** that users are experts, that repositories use JavaScript, or that a
repository has one project. Monorepos, nested repositories and mixed ecosystems are in the
first release's corpus plan below.

## What a first successful experience is

For P-3, hypothesised: point the application at a repository, and within the first screen
see which test tools and report files it found, with the evidence, and the results of the
reports it could read, with a plain statement of what it could not read and why. Nothing
was run, nothing was written to the repository, and no number is shown that cannot be traced
to a file.

For P-1 and P-5, the same screen must be readable without terminal knowledge.

## Public-source evidence about workflows

Taken from the competitive research, labelled as in that document:

- Multi-machine runs write per-shard reports and merge them in a final job (S-11).
  `hypothesis`: the merged output hides whether every shard arrived.
- Reporting tools are often adopted by wrapping the test command (S-05).
- Coverage and flaky-test services require an account and a CI step (S-19, S-14).
- Editors discover tests through per-framework extensions (S-22).

None of this was checked with a user.

## Phase 0 validation plan

Phase 0 is about finding out whether the problem is real before more is built.

**Interview script** (30 minutes, automation engineers and SDETs first, then P-4 and P-5):

1. Which test tools does your main repository use, and where do their reports end up?
2. When did you last not know whether a green result could be trusted? What did you do?
3. Walk me through the last time two reports disagreed, or a shard went missing.
4. What would you refuse to send to a hosted service? What would you accept?
5. Show me where you look first when you join a repository. What do you wish was there?
6. What number do you report upward, and how do you defend it?

Record answers verbatim where possible; do not lead with the product.

**Repository corpus for compatibility work.** Choose repositories, with permission or open
licences recorded, that cover: a pure JavaScript project, a Java or Kotlin project with
Maven or Gradle, a Python project, a .NET project, a monorepo with unrelated projects, a
repository with CI-produced artifacts, a repository with no reports at all, and one with
reports from two tools for the same code. Record the licence of each before it is used as a
fixture.

**Go and no-go signals.** Proceed if several of the people interviewed describe the
problem unprompted and say the first-screen experience above would change what they do.
Stop and rethink if the common answer is that existing reports already tell them what they
need, or that they would not run an extra tool at all.

## Open questions

- Is the first screen for P-3 the same as the first screen for P-1? If not, which wins?
- Does a team that cannot use hosted services exist in useful numbers (H-4 in the
  [landscape](./research/competitive-landscape.md))?
