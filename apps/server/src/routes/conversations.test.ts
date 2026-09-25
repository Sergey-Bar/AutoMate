import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { conversationRoutes } from './conversations.js';
import { createMemoryRepository } from '../agent/memory.js';

describe('conversations API', () => {
  let app: ReturnType<typeof Fastify>;
  let memory: ReturnType<typeof createMemoryRepository>;

  beforeEach(async () => {
    app = Fastify();
    memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  it('POST /api/conversations creates a conversation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Test' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe('Test');
  });

  it('POST /api/conversations with no title uses null', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBeNull();
  });

  it('GET /api/conversations lists all conversations', async () => {
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'B' } });
    const res = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('GET /api/conversations supports limit and offset', async () => {
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'B' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'C' } });

    const res = await app.inject({ method: 'GET', url: '/api/conversations?limit=1&offset=1' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('B');
  });

  it('GET /api/conversations supports offset-only (no limit)', async () => {
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'B' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'C' } });

    const res = await app.inject({ method: 'GET', url: '/api/conversations?offset=1' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
  });

  it('GET /api/conversations supports limit-only (no offset)', async () => {
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'B' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'C' } });

    const res = await app.inject({ method: 'GET', url: '/api/conversations?limit=2' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
  });

  it('GET /api/conversations returns 400 for invalid pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations?limit=0&offset=-1' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('GET /api/conversations returns 400 when limit exceeds maximum', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations?limit=101' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('DELETE /api/conversations/:id removes a conversation', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    const { id } = created.json();
    const res = await app.inject({ method: 'DELETE', url: `/api/conversations/${id}` });
    expect(res.statusCode).toBe(204);
    // Verify it's gone
    const listRes = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(listRes.json()).toHaveLength(0);
  });

  it('GET /api/conversations/:id/messages returns messages', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    const { id } = created.json();
    const res = await app.inject({ method: 'GET', url: `/api/conversations/${id}/messages` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/conversations/:id/messages supports limit and offset', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    const { id } = created.json();

    await memory.saveMessage({ id: 'm1', conversationId: id, role: 'user', content: 'one' });
    await memory.saveMessage({ id: 'm2', conversationId: id, role: 'assistant', content: 'two' });
    await memory.saveMessage({ id: 'm3', conversationId: id, role: 'user', content: 'three' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages?limit=1&offset=1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('m2');
  });

  it('GET /api/conversations/:id/messages supports offset-only (no limit)', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    const { id } = created.json();

    await memory.saveMessage({ id: 'm1', conversationId: id, role: 'user', content: 'one' });
    await memory.saveMessage({ id: 'm2', conversationId: id, role: 'assistant', content: 'two' });
    await memory.saveMessage({ id: 'm3', conversationId: id, role: 'user', content: 'three' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages?offset=1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
  });

  it('GET /api/conversations/:id/messages supports limit-only (no offset)', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    const { id } = created.json();

    await memory.saveMessage({ id: 'm1', conversationId: id, role: 'user', content: 'one' });
    await memory.saveMessage({ id: 'm2', conversationId: id, role: 'assistant', content: 'two' });
    await memory.saveMessage({ id: 'm3', conversationId: id, role: 'user', content: 'three' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages?limit=2`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
  });

  it('GET /api/conversations/:id/messages returns 400 for invalid pagination', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    const { id } = created.json();

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages?limit=abc&offset=-1`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  describe('error paths', () => {
    it('POST /api/conversations returns 500 when memory.saveConversation throws', async () => {
      vi.spyOn(memory, 'saveConversation').mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { title: 'Test' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
      expect(res.json().error).toBe('Failed to create conversation');
    });

    it('GET /api/conversations returns 500 when memory.listConversations throws', async () => {
      vi.spyOn(memory, 'listConversations').mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/conversations',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
      expect(res.json().error).toBe('Failed to list conversations');
    });

    it('DELETE /api/conversations/:id returns 500 when memory.getConversation throws', async () => {
      vi.spyOn(memory, 'getConversation').mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/conversations/some-id',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
      expect(res.json().error).toBe('Failed to delete conversation');
    });

    it('DELETE /api/conversations/:id returns 500 when memory.deleteConversation throws', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { title: 'To Delete' },
      });
      const { id } = created.json();

      vi.spyOn(memory, 'deleteConversation').mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/conversations/${id}`,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
      expect(res.json().error).toBe('Failed to delete conversation');
    });

    it('GET /api/conversations/:id/messages returns 500 when memory.listMessages throws', async () => {
      vi.spyOn(memory, 'listMessages').mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/conversations/some-id/messages',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toHaveProperty('error');
      expect(res.json().error).toBe('Failed to list messages');
    });
  });
});
