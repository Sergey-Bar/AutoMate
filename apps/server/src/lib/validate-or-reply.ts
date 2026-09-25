import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod/v4';
import { formatValidationError } from './validation.js';

/**
 * Validates request body against a Zod schema and sends 400 error on failure.
 * Returns parsed data on success, or null if validation failed (after sending response).
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
    reply.code(400).send({ error: formatValidationError(parsed.error.issues) });
    return null;
  }
  
  return parsed.data;
}
