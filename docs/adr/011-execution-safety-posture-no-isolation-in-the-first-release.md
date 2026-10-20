# ADR-011: Execution safety posture — control the process tree, promise no isolation

**Status:** proposed
**Date:** 2026-10-19
**Supersedes:** —

## Context

AUTOMATE (local) will eventually run the test commands a repository declares. A repository
is untrusted input: a script in it can be malicious or just destructive by accident. The
operating systems offer real isolation (Windows job-object limits and AppContainer, macOS
sandbox profiles, Linux namespaces and Landlock), but each is platform-specific, each has
limits, and none is a prerequisite for a first release that mainly reads reports.

The existing runner (`apps/runner/src/generic-spawn.ts`) has good argument, environment and
working-directory discipline and a weak termination step: it signals the child only. The
feasibility spike measured what that does on Windows
([feasibility](../local/feasibility.md)): a command launched through a `.cmd` shim leaves
every descendant running after the child is signalled.

## Decision

Proposed:

1. **The first release provides process control and no isolation, and says so.** Ending a
   command, a timeout, redaction of output and a confirmation dialog are not isolation. A
   command that runs can read files the user can read, change the repository, use the
   network and read the environment it was given. The interface states this where the user
   approves a run.
2. **Every run is explicit and previewed.** The exact argument vector, working directory,
   and the names of the environment variables passed are shown. No shell string is
   interpolated. Nothing runs during discovery.
3. **The environment is an allowlist.** Variables the user did not name are not passed.
4. **Output is bounded and redacted** with literal known secrets and recognisable patterns,
   knowing pattern redaction is best effort.
5. **On Windows, a command starts inside a job object that kills its members when it
   closes.** Signalling the child alone is not acceptable. How the job is created (a small
   shipped native helper, a native addon, or the PowerShell launcher used in the spike) is
   an open choice with a cost for each.
6. **On POSIX, a process group is signalled, then forced after a delay.** This was not
   tested and is a proposal.
7. **Isolation is a later phase**, researched per platform, optional per run, and never
   described as complete.

## Consequences

- The product can be honest that a run is as dangerous as running the command by hand.
  Users who need isolation are pointed to running the command in their own container or
  virtual machine.
- A run can always be ended, including when the product itself is killed, on Windows.
- A helper process (or native code) enters the packaging on Windows.
- The threat model lists what the posture does not stop, as accepted risks with an owner.

## Evidence

- `apps/runner/src/generic-spawn.ts` — argument, environment and working-directory
  handling worth porting, and the child-only termination that is not.
- [`docs/local/feasibility.md`](../local/feasibility.md) — the measured termination results
  and their limits.
- `local/test/proctree.test.mjs` — the tests that fail when the job
  object is removed.
