import {
  DiffCoverageStatusSchema,
  PortfolioComponentsPageSchema,
  SbomComponentsPageSchema,
  ScorecardSchema,
  SupplyChainPolicyRecordSchema,
  type DiffCoverageStatus,
  type PortfolioComponentsPage,
  type SbomComponentsPage,
  type Scorecard,
  type SupplyChainPolicy,
  type SupplyChainPolicyRecord,
} from '@automate/shared-contracts';
import { createJsonTransport, projectPath, queryString } from './json-transport.js';

/**
 * Supply chain: the SBOM inventory, where a component is used, diff coverage and the policy.
 *
 * The licence findings and the provenance summary are read through the health client — they
 * are findings and a dimension of the grade, not a second store.
 */
export interface ComponentQuery {
  type?: string | undefined;
  licence?: string | undefined;
  branch?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export interface SupplyChainClient {
  getComponents(projectId: string, query?: ComponentQuery): Promise<SbomComponentsPage>;
  /** Every project in the workspace shipping a component whose purl starts with `purl`. */
  searchPortfolio(
    purl: string,
    page?: { offset?: number; limit?: number },
  ): Promise<PortfolioComponentsPage>;
  getPolicy(projectId: string): Promise<SupplyChainPolicyRecord>;
  /** Admin only; the API refuses anyone else. */
  setPolicy(projectId: string, policy: SupplyChainPolicy): Promise<SupplyChainPolicyRecord>;
  getDiffCoverage(projectId: string, commit: string): Promise<DiffCoverageStatus>;
  /** The supply-chain scorecard on a branch, or on the project's default branch. */
  getScorecard(projectId: string, branch?: string): Promise<Scorecard>;
}

export function createSupplyChainClient(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): SupplyChainClient {
  const http = createJsonTransport(baseUrl, fetchImpl);
  return {
    getComponents: (projectId, query = {}) =>
      http.get(
        `${projectPath(projectId)}/health/components${queryString({ ...query })}`,
        SbomComponentsPageSchema,
      ),
    searchPortfolio: (purl, page = {}) =>
      http.get(
        `/api/v1/portfolio/components${queryString({ purl: purl.trim(), ...page })}`,
        PortfolioComponentsPageSchema,
      ),
    getPolicy: (projectId) =>
      http.get(
        `${projectPath(projectId)}/health/supply-chain-policy`,
        SupplyChainPolicyRecordSchema,
      ),
    setPolicy: (projectId, policy) =>
      http.put(
        `${projectPath(projectId)}/health/supply-chain-policy`,
        policy,
        SupplyChainPolicyRecordSchema,
      ),
    getDiffCoverage: (projectId, commit) =>
      http.get(
        `${projectPath(projectId)}/health/diff-coverage${queryString({ commit: commit.trim() })}`,
        DiffCoverageStatusSchema,
      ),
    getScorecard: (projectId, branch) =>
      http.get(
        `${projectPath(projectId)}/supply-chain/scorecard${queryString({ branch })}`,
        ScorecardSchema,
      ),
  };
}
