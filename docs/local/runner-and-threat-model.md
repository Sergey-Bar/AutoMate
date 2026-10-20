# AUTOMATE (local) — runner design and threat model

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

How the product will run a repository's test commands, and what can go wrong. The runner is
Phase 2; the threat model covers the first release too, because the scanner and the local
interface already handle untrusted input. The posture is in
[ADR-011](../adr/011-execution-safety-posture-no-isolation-in-the-first-release.md).

## What this design promises, and what it does not

**It promises:** nothing runs without an explicit, previewed approval; a run can always be
ended, and everything it started ends with it; output is bounded and redacted; results are
collected even when the command fails.

**It does not promise isolation.** A command that runs can read any file the user can read,
change the repository, make network connections, and read whatever environment it is given.
Ending the process, a timeout, redaction of output and a confirmation dialog do not change
that. The interface says so at the point of approval (R-026). A repository script may be
malicious or merely destructive, and from the product's side they look the same.

## States of a run

| State      | Meaning                                                                                               | Exits to                                            |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Detected   | A candidate command was found by discovery. Nothing has run.                                          | Configured, Blocked                                 |
| Configured | The user chose scope and options.                                                                     | Ready, Blocked                                      |
| Blocked    | Cannot run, with the reason: missing tool, missing dependency, no consent, conflicting configuration. | Configured (when the reason is cleared)             |
| Ready      | Preview shown and not yet approved.                                                                   | Approved, Configured (edited), Detected (discarded) |
| Approved   | The user confirmed the exact preview.                                                                 | Running, Cancelled                                  |
| Running    | The process tree is alive and output is being captured.                                               | Collecting, Cancelling, TimedOut, Crashed           |
| Cancelling | Cancellation requested; the tree is being ended.                                                      | Collecting, Crashed                                 |
| TimedOut   | The deadline passed; the tree is being ended.                                                         | Collecting                                          |
| Crashed    | The process could not start, or the supervisor lost it.                                               | Collecting, Failed                                  |
| Collecting | Process gone; declared artifacts are being read and ingested.                                         | Completed, Partial, Failed                          |
| Completed  | Exit status known and results ingested.                                                               | History                                             |
| Partial    | Some results were collected; the run did not finish cleanly.                                          | History                                             |
| Failed     | Nothing usable was produced, with the reason.                                                         | History, Configured (retry)                         |
| Cancelled  | Cancelled before it started.                                                                          | History                                             |
| History    | The record is stored.                                                                                 | none (terminal)                                     |

Exit status is never the verdict on its own. A non-zero exit with a valid report is a
partial run with results; a zero exit with no declared report is a failed collection, not a
pass.

## Starting a command

- **Argument vector, no shell.** The command is a program and a list of arguments. No string
  is interpolated, no shell is invoked by the product. Some launchers are themselves shell
  scripts (a package manager's shim); the product runs them as programs and the preview shows
  that.
- **Working directory** is a directory inside the repository, resolved and checked, with no
  `..` escape.
- **Environment** is an allowlist. Only variables the user named, plus a small fixed set the
  operating system needs, are passed. The preview lists the names. Values the user
  registered as secrets are never written to disk and are removed from output.
- **Consent** is bound to the preview: the approved command, directory and variable names
  are what is spawned. A change after approval invalidates it.
- **Dependencies are never installed implicitly.** A missing dependency blocks the run and
  says what is missing.
- **Concurrency** is limited (a proposal: one run at a time per repository at first).

## Ending a command

- **Deadline** is mandatory. There is a default, shown in the preview.
- **Windows:** the command starts inside a job object configured to kill all members when it
  closes. Timeout and cancel close it. Measured behaviour and limits are in
  [feasibility](./feasibility.md) (RISK-4). The mechanism that creates the job is an open
  choice: a small shipped native helper, a native addon, or a launcher script as used in the
  spike (about 0.4 s slower to start on the measuring machine, and dependent on PowerShell
  and runtime compilation being allowed).
- **POSIX:** a new process group is created for the command; cancel and timeout signal the
  group, wait a bounded time, then force. This is a proposal and was not tested.
- **If the product itself dies,** the job object ends the tree on Windows. On POSIX there is
  no equivalent in the proposal; a leftover tree is detected and offered for cleanup at the
  next start.
- A tree is verified gone, not assumed: the supervisor checks that no recorded process
  remains and reports it if one does.

## Output, secrets and artifacts

- Standard output and error are captured to files with a byte limit, counted in bytes. Past
  the limit the rest is dropped and a notice is recorded.
- Redaction removes registered secret values and recognisable credential patterns. Pattern
  redaction is best effort and the interface says so.
- Declared report files are collected from declared locations only, size-checked, and
  ingested through the same path as any other report. Temporary files are created in the
  application's data directory and removed on completion.
- The run record keeps the exact command, scope, start and end times, exit status, the
  termination path taken, and links to its artifacts, so a run can be reproduced.
- Retries are offered only when the underlying framework supports them and are new runs
  linked to the old one.

## Cross-platform

Windows first. Path separators, the way a launcher shim runs, the way a process tree is
ended and the notion of a process group all differ per platform, and each is a place the
design is only proposed until tested there.

## Threat model

Assets: the user's files and credentials, the repository, the stored evidence, and the
user's trust in the numbers. Adversaries: a malicious or compromised repository, a
malicious report file, a web page in the user's browser, another local user or process, and
the user's own mistakes.

Protections are described as enforceable only where the product can make them true by
itself.

| ID   | Threat                                                                                 | Mitigation                                                                                                                                                           | Enforceable by the product                       | Residual risk and owner                                                              |
| ---- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| T-01 | A repository script reads or damages files when run                                    | Accepted risk: execution is not isolated. Mitigation limited to consent, preview, a plain notice, and recommending a container or virtual machine for untrusted code | No                                               | Accepted risk. Owner: maintainers. Revisit when the sandbox phase is scheduled.      |
| T-02 | A repository script makes network connections or sends data out                        | Accepted risk, as T-01. The product itself makes no outbound connection, and a test asserts it                                                                       | Only for the product's own behaviour             | Accepted risk for executed commands. Owner: maintainers.                             |
| T-03 | Discovery runs repository code                                                         | Discovery only reads files; no script, package manager or test command is started; a test counts process spawns during a scan                                        | Yes                                              | Residual: a bug. Owner: maintainers.                                                 |
| T-04 | A command survives timeout or cancel                                                   | Job object on Windows; process group then force on POSIX; verification that the tree is gone                                                                         | Yes on Windows (tested), proposal on POSIX       | POSIX untested. Owner: maintainers.                                                  |
| T-05 | Shell interpolation of a repository-controlled string                                  | Argument vectors only; no shell string is built                                                                                                                      | Yes                                              | A launcher that is itself a shell script. Owner: maintainers.                        |
| T-06 | Credentials in output or logs                                                          | Environment allowlist; registered-value and pattern redaction on stored and displayed output                                                                         | Partly                                           | Pattern redaction misses unrecognised secrets. Accepted risk. Owner: maintainers.    |
| T-07 | Malformed or malicious XML or JSON report (entity expansion, deep nesting, huge input) | No DTD processing; size, depth, element and test-count limits at the call site; a rejection is a result; hostile fixtures run against the real parser                | Yes, once the real parser is tested              | Real parser untested (RISK-5). Owner: maintainers.                                   |
| T-08 | Report content tries to control the interface (script in a message, path tricks)       | Report text is data, escaped on display; file paths are normalised to repository-relative or null                                                                    | Yes                                              | Residual: a rendering bug. Owner: maintainers.                                       |
| T-09 | A web page in the user's browser calls the local API                                   | Loopback only, an unpredictable port, a per-launch bearer token, Host and Origin checks, no permissive cross-origin headers                                          | Yes                                              | Residual: a bug in the checks. Owner: maintainers.                                   |
| T-10 | Another local user or process reads the token or the data                              | The data directory and token file are readable by the user only; the token is not on the command line or in logs                                                     | Partly (depends on operating-system permissions) | A process running as the same user can read them. Accepted risk. Owner: maintainers. |
| T-11 | Personal data (paths, host names) leaks through display, export or diagnostics         | Redaction at the edge; a diagnostic export is a file the user inspects before sharing; nothing is sent                                                               | Yes                                              | Pattern gaps. Owner: maintainers.                                                    |
| T-12 | Stored evidence is altered or lost                                                     | Content-addressed blobs verified by digest; ingestion in one transaction; derived data rebuildable                                                                   | Yes (tested)                                     | Residual: disk corruption beyond detection. Owner: maintainers.                      |
| T-13 | A catalog or update source delivers malicious content                                  | The catalog is data validated against a schema, with no executable fields; nothing is installed without a previewed, confirmed change                                | Yes, once built                                  | Planned work. Owner: maintainers.                                                    |
| T-14 | AI output triggers an action                                                           | AI output is text only; it cannot run, install or edit; any resulting action goes through the normal consent path                                                    | Yes by construction, once built                  | Planned work. Owner: maintainers.                                                    |
| T-15 | A symlink or junction leads the scanner outside the repository                         | Links are not followed by default; a followed link must resolve inside the repository; visited real paths are tracked                                                | Yes                                              | Residual: a time-of-check race. Owner: maintainers.                                  |

## Later-phase isolation research

Not a prerequisite for any release. Recorded so the choice is informed when it is made.
Nothing here was tested, and each option is described only as far as its official
documentation was read.

- **Windows job objects** can also limit resources of the members, not only end them (S-01,
  S-02). That limits cost, not access.
- **Windows AppContainer** is documented to isolate credentials, files, network, processes
  and windows of an application (S-25). Whether an arbitrary command-line tool can be
  started inside one with the file access a test run needs was not investigated.
- **Linux Landlock** lets an unprivileged process restrict its own filesystem and network
  access and that of its future children, denying by default the actions a ruleset handles
  (S-23). Kernel support varies by version.
- **Linux bubblewrap** builds a sandbox from namespaces for unprivileged users, and its
  documentation is explicit that the protection is entirely determined by the arguments it
  is given (S-24).
- **macOS**: Apple's documentation could not be read in this research. Unverified.

A future isolation phase must decide, per platform, what a test run legitimately needs
(read the repository, write its report directory, sometimes the network) and treat anything
else as denied, and must say which of these it provides and which it does not.
