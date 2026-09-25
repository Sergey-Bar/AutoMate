import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

const LOCKED_CONTRACT_VERSION = '1.1.0' as const;

const contractSnapshotSchema = z.object({
  version: z.string().min(1),
  tools: z.record(
    z.string().min(1),
    z.object({
      inputSchema: z.record(z.string(), z.unknown()),
      outputSchema: z.record(z.string(), z.unknown()),
    }),
  ),
  errorCodes: z.array(z.string()),
});

type ContractSnapshot = z.infer<typeof contractSnapshotSchema>;

export interface DiscoveredTool {
  name: string;
}

export interface McpContractValidationResult {
  valid: boolean;
  contractVersion: string;
  validatedAt: string;
  mismatches: string[];
  diagnostics: string;
  /** Tools discovered from the live server that are NOT in the snapshot fixture (snapshot is stale). */
  newTools: string[];
}

export interface McpContractValidationOptions {
  discoveredContractVersion?: string;
}

function loadContractSnapshot(): ContractSnapshot {
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../mcp/__fixtures__/dashboard-contract-v1-snapshot.json',
  );
  const raw = fs.readFileSync(fixturePath, 'utf8');
  return contractSnapshotSchema.parse(JSON.parse(raw));
}

function buildDiagnostics(valid: boolean, mismatches: string[]): string {
  if (valid) {
    return `dashboard_mcp contract validation passed against v${LOCKED_CONTRACT_VERSION}.`;
  }
  return `dashboard_mcp contract validation failed: ${mismatches.join('; ')}`;
}

export function validateDiscoveredToolsAgainstContract(
  discoveredTools: DiscoveredTool[],
  options?: McpContractValidationOptions,
): McpContractValidationResult {
  const snapshot = loadContractSnapshot();
  const expectedToolNames = Object.keys(snapshot.tools).sort();
  const discoveredToolNames = [...new Set(discoveredTools.map((tool) => tool.name))].sort();
  const discoveredContractVersion = options?.discoveredContractVersion ?? LOCKED_CONTRACT_VERSION;
  const mismatches: string[] = [];

  if (snapshot.version !== LOCKED_CONTRACT_VERSION) {
    mismatches.push(
      `contract snapshot version mismatch: expected ${LOCKED_CONTRACT_VERSION}, got ${snapshot.version}`,
    );
  }

  if (discoveredContractVersion !== LOCKED_CONTRACT_VERSION) {
    mismatches.push(
      `discovered contract version mismatch: expected ${LOCKED_CONTRACT_VERSION}, got ${discoveredContractVersion}`,
    );
  }

  const unexpectedTools = discoveredToolNames.filter((toolName) => !expectedToolNames.includes(toolName));
  // Unexpected (new) tools are NOT a hard validation failure — they mean the snapshot is stale.
  // They are surfaced via `newTools` so callers can log a warning and prompt a snapshot update.
  const newTools = unexpectedTools;

  const missingTools = expectedToolNames.filter((toolName) => !discoveredToolNames.includes(toolName));
  if (missingTools.length > 0) {
    mismatches.push(`missing tools: ${missingTools.join(', ')}`);
  }

  const valid = mismatches.length === 0;
  const validatedAt = new Date().toISOString();

  return {
    valid,
    contractVersion: LOCKED_CONTRACT_VERSION,
    validatedAt,
    mismatches,
    diagnostics: buildDiagnostics(valid, mismatches),
    newTools,
  };
}
