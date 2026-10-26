import { z } from 'zod/v4';
import {
  AgentRuntimeReportSchema,
  EvalDatasetRunStartedSchema,
  EvalDatasetListSchema,
  EvalRunDetailSchema,
  McpServerListSchema,
  ProjectEvalsSchema,
  type AgentRuntimeReport,
  type EvalDataset,
  type EvalDatasetRunStarted,
  type EvalRunDetail,
  type McpServerList,
  type ProjectEvals,
} from '@automate/shared-contracts';
import { createJsonTransport, projectPath, queryString } from './json-transport.js';

/**
 * `GET /api/v1/projects/:id/evals/datasets`. The contract exports the schema but not its
 * inferred type, so the type is inferred here from the contract's own schema.
 */
export type EvalDatasetList = z.infer<typeof EvalDatasetListSchema>;

/** Agent quality: evals, runtime, the MCP inventory and the built-in eval runner. */
export interface AgentsClient {
  getEvals(projectId: string, branch?: string): Promise<ProjectEvals>;
  getEvalRun(projectId: string, runId: string): Promise<EvalRunDetail>;
  getRuntime(projectId: string, days: number): Promise<AgentRuntimeReport>;
  /** Automate's own chat telemetry, not a project's. */
  getChatRuntime(days: number): Promise<AgentRuntimeReport>;
  getMcpServers(projectId: string, branch?: string): Promise<McpServerList>;
  getDatasets(projectId: string): Promise<EvalDatasetList>;
  /** Operator only. Answers 202: the run is started and uploads its result when done. */
  runDataset(projectId: string, datasetId: string): Promise<EvalDatasetRunStarted>;
}

export function createAgentsClient(baseUrl = '', fetchImpl: typeof fetch = fetch): AgentsClient {
  const http = createJsonTransport(baseUrl, fetchImpl);
  const days = (value: number) => queryString({ days: Math.trunc(value) });
  return {
    getEvals: (projectId, branch) =>
      http.get(`${projectPath(projectId)}/evals${queryString({ branch })}`, ProjectEvalsSchema),
    getEvalRun: (projectId, runId) =>
      http.get(
        `${projectPath(projectId)}/evals/runs/${encodeURIComponent(runId)}`,
        EvalRunDetailSchema,
      ),
    getRuntime: (projectId, window) =>
      http.get(`${projectPath(projectId)}/agents/runtime${days(window)}`, AgentRuntimeReportSchema),
    getChatRuntime: (window) =>
      http.get(`/api/v1/chat/runtime${days(window)}`, AgentRuntimeReportSchema),
    getMcpServers: (projectId, branch) =>
      http.get(
        `${projectPath(projectId)}/agents/mcp-servers${queryString({ branch })}`,
        McpServerListSchema,
      ),
    getDatasets: (projectId) =>
      http.get(`${projectPath(projectId)}/evals/datasets`, EvalDatasetListSchema),
    runDataset: (projectId, datasetId) =>
      http.post(
        `${projectPath(projectId)}/evals/datasets/${encodeURIComponent(datasetId)}/run`,
        {},
        EvalDatasetRunStartedSchema,
      ),
  };
}

export type { EvalDataset };
