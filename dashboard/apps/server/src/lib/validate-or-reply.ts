import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';

/**
 * Validates request body against a Zod schema and sends 400 error on failure.
 * Returns parsed data on success, or null if validation failed (after sending response).
 * 
 * Uses flatten() for error formatting to match existing Dashboard error response pattern.
 * 
 * @example
 * const body = await validateOrReply(MySchema, request, reply);
 * if (!body) return; // Validation failed, error already sent
 * // Continue with validated body
 */
export async function validateOrReply<T>(
  schema: ZodSchema<T>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<T | null> {
  const parsed = schema.safeParse(request.body);
  
  if (!parsed.success) {
    reply.code(400).send({ error: parsed.error.flatten() });
    return null;
  }
  
  return parsed.data;
}
