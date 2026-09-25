import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { defectCategories, fingerprintCategories } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { validateOrReply } from '../lib/validate-or-reply.js';

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/categories
  app.get('/api/categories', async (_req, reply): Promise<void> => {
    return reply.send(await db.select().from(defectCategories));
  });

  // POST /api/categories
  const CreateBody = z.object({ name: z.string().min(1).max(64), color: z.string().optional() });
  app.post('/api/categories', async (req, reply): Promise<void> => {
    const body = await validateOrReply(CreateBody, req, reply);
    if (!body) return;
    const cat = await db.insert(defectCategories).values({
      id: randomUUID(),
      name: body.name,
      color: body.color ?? '#6b7280',
      createdAt: new Date().toISOString(),
    }).returning();
    return reply.status(201).send(cat[0]);
  });

  // PUT /api/categories/:id
  app.put<{ Params: { id: string } }>('/api/categories/:id', async (req, reply): Promise<void> => {
    const body = await validateOrReply(CreateBody, req, reply);
    if (!body) return;
    await db.update(defectCategories)
      .set({ name: body.name, color: body.color ?? '#6b7280' })
      .where(eq(defectCategories.id, req.params.id));
    return reply.send({ ok: true });
  });

  // DELETE /api/categories/:id
  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req, reply): Promise<void> => {
    const deleted = await db
      .delete(defectCategories)
      .where(eq(defectCategories.id, req.params.id))
      .returning({ id: defectCategories.id });
    if (deleted.length === 0) return reply.status(404).send({ error: 'Category not found' });
    return reply.send({ ok: true });
  });

  // GET /api/fingerprint-categories
  app.get('/api/fingerprint-categories', async (_req, reply): Promise<void> => {
    return reply.send(await db.select().from(fingerprintCategories));
  });

  // PUT /api/fingerprint-categories/:fingerprint
  const AssignBody = z.object({ categoryId: z.string() });
  app.put<{ Params: { fingerprint: string } }>('/api/fingerprint-categories/:fingerprint', async (req, reply): Promise<void> => {
    const body = await validateOrReply(AssignBody, req, reply);
    if (!body) return;
    await db
      .insert(fingerprintCategories)
      .values({ fingerprint: req.params.fingerprint, categoryId: body.categoryId, assignedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: fingerprintCategories.fingerprint, set: { categoryId: body.categoryId, assignedAt: new Date().toISOString() } });
    return reply.send({ ok: true });
  });

  // DELETE /api/fingerprint-categories/:fingerprint
  app.delete<{ Params: { fingerprint: string } }>('/api/fingerprint-categories/:fingerprint', async (req, reply): Promise<void> => {
    const deleted = await db
      .delete(fingerprintCategories)
      .where(eq(fingerprintCategories.fingerprint, req.params.fingerprint))
      .returning({ fingerprint: fingerprintCategories.fingerprint });
    if (deleted.length === 0) {
      return reply.status(404).send({ error: 'Fingerprint category assignment not found' });
    }
    return reply.send({ ok: true });
  });
}
