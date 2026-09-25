import { tool } from 'ai';
import type { ToolExecutionOptions } from 'ai';
import type { ConnectorManifest } from '../../../../packages/connector-sdk/src/types.js';

export interface CredentialProvider {
  getCredentials: (connectorName: string) => Promise<Record<string, unknown> | null>;
}

export interface AdaptConnectorToolsOptions {
  credentialProvider?: CredentialProvider;
  requireApproval?: boolean;
}

export function adaptConnectorTools(
  manifests: ConnectorManifest[],
  options?: CredentialProvider | AdaptConnectorToolsOptions,
): Record<string, ReturnType<typeof tool>> {
  // Handle both old signature (CredentialProvider) and new signature (AdaptConnectorToolsOptions)
  const normalizedOptions: AdaptConnectorToolsOptions =
    options && 'getCredentials' in options
      ? { credentialProvider: options }
      : (options ?? {});

  const adaptedTools: Record<string, ReturnType<typeof tool>> = {};

  for (const manifest of manifests) {
    for (const connectorTool of manifest.tools) {
      const adaptedToolName = `${manifest.name}.${connectorTool.name}`;

      const adaptedTool = tool({
        description: connectorTool.description,
        inputSchema: connectorTool.inputSchema,
        needsApproval: normalizedOptions.requireApproval ?? false,
        execute: async (input: unknown, toolOptions?: ToolExecutionOptions) => {
          const rawCredentials = normalizedOptions.credentialProvider?.getCredentials
            ? (await normalizedOptions.credentialProvider.getCredentials(manifest.name)) ?? {}
            : {};
          // Filter to only string values as expected by connector handlers
          const credentials: Record<string, string> = {};
          for (const [key, value] of Object.entries(rawCredentials)) {
            if (typeof value === 'string') {
              credentials[key] = value;
            }
          }
          return connectorTool.handler(input, {
            credentials,
            abortSignal: toolOptions?.abortSignal ?? new AbortController().signal,
          });
        },
      });

      adaptedTools[adaptedToolName] = adaptedTool as unknown as ReturnType<typeof tool>;
    }
  }

  return adaptedTools;
}
