# AUTOMATE (local) — repository discovery engine

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

How the scanner finds a repository's projects, test tools, commands and existing reports. It
is read-only, incremental, bounded, and treats everything it reads as untrusted. It is the
only part of the first release that touches the user's repository.

## Rules

1. **Read-only.** The scanner opens files for reading and nothing else. It creates no
   file, directory, lock or cache inside the repository. Its own state lives in the
   application's data directory. R-001 is tested by hashing the tree before and after.
2. **Nothing is executed.** Discovery reads manifests and configuration files. It never runs
   a script, a package manager or a test command. A command found is a candidate to show,
   not to run.
3. **Everything read is untrusted data.** Scripts, configuration, logs and reports are
   parsed, never evaluated, and are size-limited before being parsed.
4. **Every finding carries evidence** (`path:line` text) and a confidence. A finding with no
   evidence is not produced.
5. **Failure is a result.** An unreadable file, an unsupported format or a limit hit is
   recorded with a reason and shown; it never aborts the scan silently.

## Platforms

Windows is the platform the first release is exercised on. macOS and Linux are designed for
(POSIX paths, case-sensitive and case-insensitive filesystems) and not yet tested. Windows
adds long paths, reserved names, drive letters and junctions; the scanner must not follow a
junction out of the repository.

## Repository selection and validation

The user picks a directory. It is accepted only if it exists, is a directory, is readable,
is not a filesystem root or a user's home directory, and is not already inside another
registered repository without saying so. A repository is a directory, not necessarily a Git
checkout; a Git root is detected as evidence when present. Nested repositories (a checkout
inside a checkout, submodules) are registered as separate projects of the parent, with the
boundary recorded.

## Traversal

- **Ignore rules.** Directories that are large and never hold manifests or reports are not
  entered: dependency directories (for example `node_modules`, `vendor`, virtual
  environments), version-control internals, and build output, with the exception of named
  report locations below. The default list is a starting point and the user can extend it.
  A `.gitignore` is read as a hint for what to skip, never as a reason to hide a report the
  user points at.
- **Hidden directories** are skipped by default except those on an allowlist of known
  report and CI locations.
- **Symlinks and junctions.** Not followed by default. A followed link is resolved and must
  stay inside the repository; the set of visited real paths is kept so a loop ends.
- **Limits** (all proposals; the actual values need a measurement on named hardware):
  maximum depth, maximum entries per directory, maximum files visited, maximum bytes read
  per file, and maximum total bytes read per scan. Hitting a limit stops that branch, marks
  the scan partial, and says which limit.
- **Order is deterministic** (sorted), so two scans of one tree produce the same result.
- **Large repositories.** Walk iteratively, never build the full path list in memory before
  filtering, and read manifests lazily.

## Detection

The existing detection code is the starting point; the table says what is reused and what is
new.

| Concern                                 | Source                                                               | Status                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ecosystem and package-manager detection | `packages/projects/src/detect/`, eight ecosystems, evidence required | Reuse after extraction                                                                                       |
| Candidate commands as argument vectors  | the same package; commands are arrays, never shell strings           | Reuse                                                                                                        |
| Reading files and listing paths         | `RepositoryView` port in the same package                            | Reuse the port; the file-system implementation reads whole files and does not guard loops, so it is replaced |
| Size, depth, count and symlink limits   | not present                                                          | New                                                                                                          |
| Report discovery by content             | not present                                                          | New                                                                                                          |
| Monorepo and nested project boundaries  | partial                                                              | Extend                                                                                                       |

### The detector contract

A detector is a pure function over a read-only view of the repository.

```ts
interface RepositoryView {
  paths(): Promise<readonly string[]>; // repo-relative, POSIX separators, sorted
  read(relativePath: string, maxBytes: number): Promise<ReadResult>; // bounded
}

type ReadResult =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'absent' }
  | { kind: 'refused'; reason: 'too-large' | 'unreadable' | 'binary' };

interface Finding {
  detector: string; // stable id
  detectorVersion: string;
  subject: string; // what was found, in the detector's vocabulary
  evidence: readonly string[]; // each "path:line text"; at least one
  confidence: number; // 0..1, a property of the detector, never a gate
  limits: readonly string[]; // what could not be checked
}

interface Detector {
  id: string;
  detect(view: RepositoryView): Promise<readonly Finding[]>;
}
```

A new detector is added by registering it; the core loop does not change. A finding that
fails schema validation is a test failure of the detector, not a silent drop.

### Confidence

Proposed, and a property of the detector rather than a threshold the product applies:

- 0.9 to 1.0: a declaration that names the tool and the command in a manifest or a
  configuration file, with the tool's own configuration file present.
- 0.5 to 0.8: a dependency on the tool without configuration, or configuration without a
  declared command.
- 0.1 to 0.4: a file-name or directory-name match only.

The numbers are a ranking aid. They are never used to decide whether to show a finding, and
the evidence is always shown beside them.

## Report discovery

- **Known locations** per ecosystem and tool: conventional report directories and file
  names, as a data table the user can extend.
- **Custom locations** the user adds; a path outside the repository is allowed only if the
  user adds it explicitly, and is marked external.
- **By content, not name.** A candidate file is sniffed (its first bytes) and, if
  recognised, handed to the matching parser. A file named like a report that is not one is
  `unrecognised-format`; an empty file is `empty-input`. Both are listed.
- **Staleness.** Each report shows its age (K-09). No stale verdict is given until the right
  threshold is known.
- **Duplicates.** Equal bytes are one artifact with several locations; different formats of
  one execution are grouped by the reconciliation rules in [data contracts](./data-contracts.md).

## Incremental scanning

A scan stores, per file visited, its size and modification time and the digest of what was
read. A rescan skips unchanged files and re-parses changed ones. The cache is invalid when
the detector or parser version changes, when the ignore list changes, or when the repository
root changes. Derived data can always be rebuilt from stored raw artifacts, so a bad cache
costs time, not correctness.

## Cancellation and a repository that changes underneath

- A scan can be cancelled at any time; it checks the cancellation flag between directory
  entries and between file reads, and a cancelled scan keeps what it already stored,
  marked partial.
- A file that changes between being listed and being read is read as it is at read time and
  its modification time is recorded. If it changes during the read, the read is repeated
  once and, if still unstable, the file is recorded as `changed-during-read` and not
  ingested.
- A directory that disappears mid-scan is recorded and skipped.

## Errors

Permission denied, a file locked by another program, a path too long, a bad encoding, a
file that is not a regular file: each becomes a record with a reason, attached to the scan,
and is shown. The scan's status is `complete`, `partial` or `failed`, never silently green.

## Verification

The detector tests in `packages/projects`, a hostile-input corpus for traversal (symlink
loops, very deep trees, huge files, special names), the read-only tree-hash test, and the
Phase 0 repository corpus. None of the new traversal limits has a test yet; they are
requirements R-001 to R-004.
