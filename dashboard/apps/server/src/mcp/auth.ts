import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isEnabled } from '../services/feature-flags.js';
import {
  loadAuthConfig,
  SESSION_COOKIE_NAME,
  validateApiKey,
  validateSessionToken,
} from '../services/auth.js';
import { logAuditEvent } from '../services/audit.js';
import { MCP_ERROR_CODES } from './contract.js';
import { deriveMcpPolicy, type McpAuthContext, type McpPolicy } from './policy.js';

declare module 'fastify' {
  interface FastifyRequest {
    mcpAuthContext: McpAuthContext | null;
    mcpPolicy: McpPolicy | null;
  }
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (typeof authorizationHeader !== 'string') return null;

  const match = authorizationHeader.match(/^\s*Bearer\s+(.+)\s*$/i);
  if (!match) return null;

  const token = match[1]?.trim();
  return token ? token : null;
}

function findApiKeyActor(key: string): string | null {
  const config = loadAuthConfig();
  const keyBuffer = Buffer.from(key);

  const matchedKey = config.keys.find((stored) => {
    const storedBuffer = Buffer.from(stored.key);
    if (storedBuffer.length !== keyBuffer.length) return false;
    return crypto.timingSafeEqual(storedBuffer, keyBuffer);
  });

  return matchedKey?.id ?? null;
}

function extractSessionActor(sessionToken: string): string | null {
  const [keyId] = sessionToken.split(':');
  return keyId && keyId.length > 0 ? keyId : null;
}

/**
 * Returns true when the raw bearer token matches the DASHBOARD_SERVICE_ACCOUNT_KEY
 * environment variable using a timing-safe comparison.
 */
function isServiceAccountKey(key: string): boolean {
  const serviceKey = process.env.DASHBOARD_SERVICE_ACCOUNT_KEY;
  if (!serviceKey) return false;
  const keyBuf = Buffer.from(key);
  const svcBuf = Buffer.from(serviceKey);
  if (keyBuf.length !== svcBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, svcBuf);
}

function extractAuditedTool(request: FastifyRequest): string {
  const body = request.body as
    | {
      params?: {
        name?: unknown;
      };
    }
    | undefined;

  const candidate = body?.params?.name;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'unknown';
}

export function extractMcpAuthContext(request: FastifyRequest): McpAuthContext | null {
  const bearerToken = extractBearerToken(request.headers.authorization);
  if (bearerToken && validateApiKey(bearerToken)) {
    const actor = findApiKeyActor(bearerToken);
    if (actor) {
      return {
        actor,
        source: 'api_key',
        actorType: isServiceAccountKey(bearerToken) ? 'service' : 'user',
        authenticatedAt: new Date().toISOString(),
      };
    }
  }

  const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];
  if (typeof sessionToken === 'string' && validateSessionToken(sessionToken)) {
    const actor = extractSessionActor(sessionToken);
    if (actor) {
      return {
        actor,
        source: 'session',
        actorType: 'user',
        authenticatedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

export function registerMcpAuthDecorators(app: FastifyInstance): void {
  app.decorateRequest('mcpAuthContext', null);
  app.decorateRequest('mcpPolicy', null);
}

export async function mcpAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auditedTool = extractAuditedTool(request);

  const authContext = extractMcpAuthContext(request);
  if (!authContext) {
    request.server.log.info({
      event: 'mcp.auth',
      actor: 'anonymous',
      source: 'none',
      tool: auditedTool,
      result: 'denied',
      reason: MCP_ERROR_CODES.UNAUTHORIZED,
    }, 'MCP auth denied');

    void reply.status(401).send({
      error: 'Unauthorized',
      code: MCP_ERROR_CODES.UNAUTHORIZED,
    });
    return;
  }

  if (!isEnabled('mcp-server')) {
    request.server.log.info({
      event: 'mcp.auth',
      actor: authContext.actor,
      source: authContext.source,
      tool: auditedTool,
      result: 'denied',
      reason: MCP_ERROR_CODES.FEATURE_DISABLED,
    }, 'MCP auth denied — feature disabled');

    void reply.status(404).send({
      error: 'MCP server is disabled',
      code: MCP_ERROR_CODES.FEATURE_DISABLED,
    });
    return;
  }

  request.mcpAuthContext = authContext;
  request.mcpPolicy = deriveMcpPolicy(authContext);

  logAuditEvent({
    actorId: authContext.actor,
    actorType: authContext.actorType,
    action: 'mcp.tool_call',
    details: {
      tool: auditedTool,
      source: authContext.source,
    },
  });

  request.server.log.info({
    event: 'mcp.auth',
    actor: authContext.actor,
    source: authContext.source,
    tool: auditedTool,
    result: 'allowed',
  }, 'MCP auth allowed');
}
