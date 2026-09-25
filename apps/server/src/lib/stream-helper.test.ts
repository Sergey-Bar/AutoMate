import { describe, it, expect, vi } from 'vitest';
import { pipeResponseStream } from './stream-helper.js';
import type { FastifyReply } from 'fastify';

describe('stream-helper', () => {
  describe('pipeResponseStream', () => {
    it('should pipe a Response stream to Fastify reply', async () => {
      // Mock Response with a simple text stream
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('Hello '));
          controller.enqueue(encoder.encode('World'));
          controller.close();
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'X-Custom-Header': 'test',
        },
      });

      // Mock Fastify reply
      const writtenChunks: Uint8Array[] = [];
      const mockReply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn((chunk: Uint8Array) => {
            writtenChunks.push(chunk);
          }),
          end: vi.fn(),
        },
      } as unknown as FastifyReply;

      await pipeResponseStream(response, mockReply);

      // Verify headers were written
      expect(mockReply.raw.writeHead).toHaveBeenCalledWith(200, {
        'content-type': 'text/plain',
        'x-custom-header': 'test',
      });

      // Verify chunks were written
      expect(mockReply.raw.write).toHaveBeenCalledTimes(2);
      expect(writtenChunks).toHaveLength(2);

      // Verify response was ended
      expect(mockReply.raw.end).toHaveBeenCalledOnce();

      // Verify the content is correct
      const decoder = new TextDecoder();
      const content = writtenChunks.map((chunk) => decoder.decode(chunk)).join('');
      expect(content).toBe('Hello World');
    });

    it('should handle empty body', async () => {
      const response = new Response(null, {
        status: 204,
        headers: { 'X-Empty': 'true' },
      });

      const mockReply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        },
      } as unknown as FastifyReply;

      await pipeResponseStream(response, mockReply);

      expect(mockReply.raw.writeHead).toHaveBeenCalledWith(204, {
        'x-empty': 'true',
      });
      expect(mockReply.raw.write).not.toHaveBeenCalled();
      expect(mockReply.raw.end).toHaveBeenCalledOnce();
    });

    it('should handle multiple headers with the same name', async () => {
      const response = new Response('test', {
        status: 200,
        headers: [
          ['Set-Cookie', 'a=1'],
          ['Set-Cookie', 'b=2'],
        ],
      });

      const mockReply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        },
      } as unknown as FastifyReply;

      await pipeResponseStream(response, mockReply);

      // Headers.forEach() will iterate over all headers, but duplicate keys
      // will be overwritten in the Record<string, string> object.
      // This test documents the current behavior.
      expect(mockReply.raw.writeHead).toHaveBeenCalled();
      const headers = vi.mocked(mockReply.raw.writeHead).mock.calls[0]?.[1] as Record<string, string>;
      // The last Set-Cookie header wins
      expect(headers['set-cookie']).toBe('b=2');
    });

    it('should propagate errors from stream reading', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new Error('Stream error'));
        },
      });

      const response = new Response(stream, { status: 200 });

      const mockReply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        },
      } as unknown as FastifyReply;

      await expect(pipeResponseStream(response, mockReply)).rejects.toThrow('Stream error');
    });

    it('should handle large streams in chunks', async () => {
      const encoder = new TextEncoder();
      const largeText = 'A'.repeat(100_000);
      const stream = new ReadableStream({
        start(controller) {
          // Send in 10 chunks
          for (let i = 0; i < 10; i++) {
            controller.enqueue(encoder.encode(largeText.slice(i * 10_000, (i + 1) * 10_000)));
          }
          controller.close();
        },
      });

      const response = new Response(stream, { status: 200 });

      const writtenChunks: Uint8Array[] = [];
      const mockReply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn((chunk: Uint8Array) => {
            writtenChunks.push(chunk);
          }),
          end: vi.fn(),
        },
      } as unknown as FastifyReply;

      await pipeResponseStream(response, mockReply);

      expect(mockReply.raw.write).toHaveBeenCalledTimes(10);
      expect(mockReply.raw.end).toHaveBeenCalledOnce();

      const decoder = new TextDecoder();
      const content = writtenChunks.map((chunk) => decoder.decode(chunk)).join('');
      expect(content).toBe(largeText);
    });
  });
});
