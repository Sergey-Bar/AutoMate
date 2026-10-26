import {
  AiCodePullRequestListSchema,
  AiCodeReportSchema,
  PortfolioAiCodeSchema,
  type AiAttribution,
  type AiCodePullRequestList,
  type AiCodeReport,
  type PortfolioAiCode,
} from '@automate/shared-contracts';
import { createJsonTransport, projectPath, queryString } from './json-transport.js';

/** AI-written code: kinds of authorship and tools, never people (the API sends none). */
export interface AiCodeClient {
  getReport(projectId: string, days: number): Promise<AiCodeReport>;
  getPullRequests(
    projectId: string,
    query?: { attribution?: AiAttribution | undefined; offset?: number; limit?: number },
  ): Promise<AiCodePullRequestList>;
  getPortfolio(days: number): Promise<PortfolioAiCode>;
}

export function createAiCodeClient(baseUrl = '', fetchImpl: typeof fetch = fetch): AiCodeClient {
  const http = createJsonTransport(baseUrl, fetchImpl);
  return {
    getReport: (projectId, days) =>
      http.get(
        `${projectPath(projectId)}/ai-code${queryString({ days: Math.trunc(days) })}`,
        AiCodeReportSchema,
      ),
    getPullRequests: (projectId, query = {}) =>
      http.get(
        `${projectPath(projectId)}/ai-code/pull-requests${queryString({ ...query })}`,
        AiCodePullRequestListSchema,
      ),
    getPortfolio: (days) =>
      http.get(
        `/api/v1/portfolio/ai-code${queryString({ days: Math.trunc(days) })}`,
        PortfolioAiCodeSchema,
      ),
  };
}
