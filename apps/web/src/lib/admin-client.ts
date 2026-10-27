import { z } from 'zod/v4';
import { parse } from './qa-client.js';

/**
 * The admin's view of people and the audit trail (ADR-014, team and enterprise):
 * `/api/v1/members` and `/api/v1/audit`. Every route behind it answers an admin only.
 */
export const MemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['viewer', 'operator', 'admin']),
  disabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  joinedAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const AuditEventSchema = z.object({
  seq: z.number().nullable(),
  timestamp: z.string(),
  actorId: z.string(),
  action: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  ip: z.string().nullable(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

const AuditPageSchema = z.object({
  events: z.array(AuditEventSchema),
  next: z.number().nullable(),
});
const VerifySchema = z.object({
  intact: z.boolean(),
  breaks: z.array(z.object({ seq: z.number(), problem: z.string() })),
  head: z.object({ seq: z.number(), hash: z.string() }).nullable(),
});
export type AuditVerification = z.infer<typeof VerifySchema>;
const OkSchema = z.object({ ok: z.literal(true) });

export interface AdminClient {
  listMembers(): Promise<Member[]>;
  updateMember(
    userId: string,
    change: { role?: Member['role']; disabled?: boolean },
  ): Promise<void>;
  removeMember(userId: string): Promise<void>;
  listAudit(before?: number): Promise<z.infer<typeof AuditPageSchema>>;
  verifyAudit(): Promise<AuditVerification>;
  /** A link the browser downloads; the session cookie is the credential. */
  exportUrl(format: 'ndjson' | 'csv'): string;
}

export function createAdminClient(baseUrl = '', fetchImpl: typeof fetch = fetch): AdminClient {
  const send = async <T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return parse(response, schema, path);
  };
  const member = (userId: string) => `/api/v1/members/${encodeURIComponent(userId)}`;
  return {
    listMembers: async () =>
      (await send('GET', '/api/v1/members', z.object({ members: z.array(MemberSchema) }))).members,
    updateMember: async (userId, change) => {
      await send('PATCH', member(userId), OkSchema, change);
    },
    removeMember: async (userId) => {
      await send('DELETE', member(userId), OkSchema);
    },
    listAudit: (before) =>
      send(
        'GET',
        `/api/v1/audit?limit=50${before === undefined ? '' : `&before=${String(before)}`}`,
        AuditPageSchema,
      ),
    verifyAudit: () => send('GET', '/api/v1/audit/verify', VerifySchema),
    exportUrl: (format) => `${baseUrl}/api/v1/audit/export${format === 'csv' ? '?format=csv' : ''}`,
  };
}
