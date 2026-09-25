/**
 * Stream response helper utilities for piping Web Response streams to Fastify replies
 */

import type { FastifyReply } from 'fastify';

/**
 * Pipes a Web API Response stream to a Fastify reply raw stream
 * 
 * @param response - Web API Response object with a readable stream body
 * @param reply - Fastify reply object
 */
export async function pipeResponseStream(
  response: Response,
  reply: FastifyReply
): Promise<void> {
  // Copy all headers from the Response to the Fastify reply
  const headers: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });

  // Write the status and headers to the raw response
  reply.raw.writeHead(response.status, headers);

  // Stream the body if present
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        reply.raw.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  // End the response
  reply.raw.end();
}
