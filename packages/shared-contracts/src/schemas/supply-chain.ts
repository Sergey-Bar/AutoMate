import { z } from 'zod/v4';

/**
 * Supply chain and diff coverage, as the wire contract.
 *
 * ## One policy record per project, and what each half decides
 *
 * `licences` is judged by `evaluateLicence` in `@automate/reporting` against every component
 * of the project's latest SBOM: `denied` is a violation, `unlisted` is one only when an allow
 * list exists, and `unknown` (no licence, `NOASSERTION`, `NONE`, an unreadable expression) is
 * one unless `failOnUnknown` is turned off — absence is not permission. Each violation is a
 * finding in Dependencies from the tool `automate-licence`.
 *
 * `provenance` is the trust `verifyProvenance` in `@automate/reporter` checks a
 * `slsa-provenance` upload against. With no keys and no roots a signature is
 * `not_configured`, never `verified`: a key the document supplied itself proves nothing.
 *
 * A project with no policy record has no licence evaluation at all — the gate is not
 * configured, which is different from configured and clean — and provenance is verified
 * against an empty trust set.
 */

const LicenceId = z.string().trim().min(1).max(200);
const Pem = z.string().min(1).max(20_000);

export const SupplyChainLicencePolicySchema = z.object({
  /** When present — even empty — only these licences are allowed. */
  allow: z.array(LicenceId).max(500).optional(),
  deny: z.array(LicenceId).max(500).optional(),
  /** A component with no readable licence is a violation unless this is `false`. */
  failOnUnknown: z.boolean().default(true),
});
export type SupplyChainLicencePolicy = z.infer<typeof SupplyChainLicencePolicySchema>;

/**
 * Where a provenance upload's expected artifact digest comes from.
 *
 * `upload-query`: the upload must name it as `digest=sha256:<hex>`, and one without is
 * refused. Unset: a digest is checked when the upload names one, and not otherwise.
 */
export const EXPECTED_DIGEST_SOURCES = ['upload-query'] as const;

/**
 * A signer a root-chained certificate must name. `subject` is the exact SAN URI or email
 * (for GitHub Actions, the workflow ref URI); `issuer`, when given, the OIDC issuer from the
 * Fulcio extension (1.3.6.1.4.1.57264.1.8, or the legacy 1.3.6.1.4.1.57264.1.1).
 */
export const TrustedIdentitySchema = z.object({
  subject: z.string().trim().min(1).max(1000),
  issuer: z.string().trim().min(1).max(500).optional(),
});
export type TrustedIdentity = z.infer<typeof TrustedIdentitySchema>;

export const SupplyChainProvenancePolicySchema = z.object({
  /** Builder ids trusted to provide SLSA build level 3. Unset: level 3 cannot be claimed. */
  allowedBuilders: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  trustedKeysPem: z.array(Pem).max(20).default([]),
  trustedRootsPem: z.array(Pem).max(20).default([]),
  /**
   * Who may sign under `trustedRootsPem`. Without one, a certificate signature is
   * `not_configured` however well it chains: a public CA issues to anyone with an account.
   */
  trustedIdentities: z.array(TrustedIdentitySchema).max(50).optional(),
  expectedDigestSource: z.enum(EXPECTED_DIGEST_SOURCES).optional(),
});
export type SupplyChainProvenancePolicy = z.infer<typeof SupplyChainProvenancePolicySchema>;

/** `PUT /api/v1/projects/:id/health/supply-chain-policy` */
export const SupplyChainPolicySchema = z.object({
  licences: SupplyChainLicencePolicySchema.default({ failOnUnknown: true }),
  provenance: SupplyChainProvenancePolicySchema.default({
    trustedKeysPem: [],
    trustedRootsPem: [],
  }),
});
export type SupplyChainPolicy = z.infer<typeof SupplyChainPolicySchema>;

/** `GET /api/v1/projects/:id/health/supply-chain-policy` — `policy` is `null` until one is saved. */
export const SupplyChainPolicyRecordSchema = z.object({
  projectId: z.string().min(1),
  policy: SupplyChainPolicySchema.nullable(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.string().nullable(),
});
export type SupplyChainPolicyRecord = z.infer<typeof SupplyChainPolicyRecordSchema>;

/** One component of a project's latest SBOM on a branch. */
export const SbomComponentRecordSchema = z.object({
  purl: z.string().nullable(),
  name: z.string().min(1),
  version: z.string().nullable(),
  type: z.string().min(1),
  licences: z.array(z.string()).readonly(),
  licenceExpression: z.string().nullable(),
  supplier: z.string().nullable(),
  branch: z.string().min(1),
  reportId: z.string().nullable(),
});
export type SbomComponentRecord = z.infer<typeof SbomComponentRecordSchema>;

/** `GET /api/v1/projects/:id/health/components` */
export const SbomComponentsPageSchema = z.object({
  branch: z.string().min(1),
  components: z.array(SbomComponentRecordSchema).readonly(),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
});
export type SbomComponentsPage = z.infer<typeof SbomComponentsPageSchema>;

/** One project in the caller's workspace that ships a component matching the search. */
export const PortfolioComponentSchema = z.object({
  projectId: z.string().min(1),
  project: z.string().min(1),
  slug: z.string().min(1),
  branch: z.string().min(1),
  purl: z.string().min(1),
  name: z.string().min(1),
  version: z.string().nullable(),
});
export type PortfolioComponent = z.infer<typeof PortfolioComponentSchema>;

/** `GET /api/v1/portfolio/components?purl=<prefix>` */
export const PortfolioComponentsPageSchema = z.object({
  matches: z.array(PortfolioComponentSchema).readonly(),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
});
export type PortfolioComponentsPage = z.infer<typeof PortfolioComponentsPageSchema>;

/** Diff coverage of one commit on one branch, as `diffCoverage` in `@automate/reporting` computed it. */
export const DiffCoverageRecordSchema = z.object({
  covered: z.number().int().min(0),
  executable: z.number().int().min(0),
  /** `covered / executable`, 0–1; `null` when no changed line is executable. */
  ratio: z.number().min(0).max(1).nullable(),
  uncovered: z
    .array(z.object({ path: z.string().min(1), lines: z.array(z.number().int().min(1)) }))
    .readonly(),
  unmeasuredFiles: z.array(z.string()).readonly(),
  computedAt: z.iso.datetime(),
});
export type DiffCoverageRecord = z.infer<typeof DiffCoverageRecordSchema>;

/**
 * `GET /api/v1/projects/:id/health/diff-coverage?commit=`
 *
 * Whichever of the diff and the line coverage arrives second computes the result, so a
 * commit can be waiting for either one.
 */
export const DiffCoverageStatusSchema = z.object({
  projectId: z.string().min(1),
  commit: z.string().min(1),
  branch: z.string().nullable(),
  state: z.enum(['computed', 'waiting-for-coverage', 'waiting-for-diff', 'none']),
  result: DiffCoverageRecordSchema.nullable(),
});
export type DiffCoverageStatus = z.infer<typeof DiffCoverageStatusSchema>;
