import { z } from 'zod/v4';

/**
 * What a repository scan found: every runnable tool, every QA report already on
 * disk, which QA capabilities are in use, and what the toolbox recommends.
 *
 * ## One vocabulary for tools, reports and recommendations
 *
 * `QA_CAPABILITIES` is the axis the dashboard, the runner and the toolbox all group
 * by. It is deliberately wider than `SCORE_CATEGORIES`: the score has five rows it can
 * compute a number for, and a QA lead also needs to know whether the repository has a
 * secret scanner or a mutation suite — neither of which is a score row, and both of
 * which are a gap worth naming.
 */
export const QA_CAPABILITIES = [
  'unit',
  'integration',
  'e2e',
  'coverage',
  'static-analysis',
  'types',
  'formatting',
  'sast',
  'secrets',
  'dependencies',
  'performance',
  'accessibility',
  'mutation',
  'contract',
  'visual',
  'ci',
] as const;
export const QaCapabilitySchema = z.enum(QA_CAPABILITIES);
export type QaCapability = z.infer<typeof QaCapabilitySchema>;

/** Everything a script can be, which is the capabilities plus the non-QA chores. */
export const TOOL_KINDS = [
  ...QA_CAPABILITIES,
  'build',
  'database',
  'docs',
  'dev',
  'other',
] as const;
export const ToolKindSchema = z.enum(TOOL_KINDS);
export type ToolKind = z.infer<typeof ToolKindSchema>;

/**
 * One command the repository itself declares, resolved to an argv by the server.
 *
 * **The browser never sends this back.** It sends `id`, and the server re-scans and
 * resolves the id to an argv on its own side, so the list is an allowlist the
 * repository wrote rather than a form a caller can fill in.
 */
export const RepoToolSchema = z.object({
  id: z.string().min(1),
  /** The script or target name, as the manifest spells it. */
  name: z.string().min(1),
  /** The argv joined for display only; it is never parsed back. */
  label: z.string().min(1),
  kind: ToolKindSchema,
  argv: z.array(z.string().min(1)).min(1),
  /** Repo-relative, POSIX separators; `.` is the repository root. */
  workingDirectory: z.string().min(1),
  /** Which manifest declared it: `package.json`, `apps/web/package.json`, `Makefile`, `profile`. */
  source: z.string().min(1),
  /** The script body or manifest line, so the operator can see what will run. */
  evidence: z.string().min(1),
  /** False for a server or a watcher: a run that never exits is not a run. */
  runnable: z.boolean(),
  reason: z.string().min(1).nullable(),
});
export type RepoTool = z.infer<typeof RepoToolSchema>;

export const REPORT_KINDS = [
  'coverage',
  'tests',
  'lint',
  'security',
  'performance',
  'quality',
] as const;
export const ReportKindSchema = z.enum(REPORT_KINDS);

export const ReportStatusSchema = z.enum(['good', 'warn', 'bad', 'info']);

/** One report file found on disk, and the numbers read out of it. */
export const RepoReportSchema = z.object({
  path: z.string().min(1),
  kind: ReportKindSchema,
  format: z.string().min(1),
  /** One sentence a person can read without opening the file. */
  headline: z.string().min(1),
  metrics: z.record(z.string(), z.number()),
  status: ReportStatusSchema,
});
export type RepoReport = z.infer<typeof RepoReportSchema>;

/** A catalogue tool the scan found evidence of. */
export const DetectedToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capability: QaCapabilitySchema,
  evidence: z.string().min(1),
});
export type DetectedTool = z.infer<typeof DetectedToolSchema>;

export const ToolboxEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capability: QaCapabilitySchema,
  description: z.string().min(1),
  ecosystems: z.array(z.string().min(1)).min(1),
  status: z.enum(['in-use', 'recommended', 'available']),
  priority: z.enum(['high', 'medium', 'low']),
  /** Why this status: the evidence for `in-use`, the gap for `recommended`. */
  reason: z.string().min(1),
  /** A setup command, shown as text and never executed by the product. */
  setup: z.string().min(1),
  docsUrl: z.string().url(),
});
export type ToolboxEntry = z.infer<typeof ToolboxEntrySchema>;

export const CapabilityCoverageSchema = z.object({
  capability: QaCapabilitySchema,
  covered: z.boolean(),
  /** Catalogue tool names and repository scripts that provide it. */
  providers: z.array(z.string().min(1)),
  weight: z.number().min(0),
});
export type CapabilityCoverage = z.infer<typeof CapabilityCoverageSchema>;

export const RepoScanSchema = z.object({
  scannedAt: z.string().min(1),
  ecosystems: z.array(z.string().min(1)),
  manifests: z.number().int().min(0),
  testFiles: z.number().int().min(0),
  sourceFiles: z.number().int().min(0),
  tools: z.array(RepoToolSchema),
  reports: z.array(RepoReportSchema),
  detected: z.array(DetectedToolSchema),
  capabilities: z.array(CapabilityCoverageSchema),
  /** 0–100: the weighted share of QA capabilities the repository has a tool for. */
  maturity: z.number().min(0).max(100),
  toolbox: z.array(ToolboxEntrySchema),
});
export type RepoScan = z.infer<typeof RepoScanSchema>;
