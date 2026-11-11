// The guest contact book: phone, WhatsApp, Telegram, Skype, email, anything else. Producers edit it.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { DEFAULT_LANGUAGE } from '@waar-connect/shared';
import { asc, eq, ilike, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contacts } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';

const Id = z.object({ id: z.uuid() });
const Query = z.object({ q: z.string().trim().max(80).optional() });
const field = z.string().trim().max(120).nullable().optional();
const ContactBody = z.object({
  displayName: z.string().trim().min(1).max(80),
  casparName: field,
  language: z.string().min(2).max(8).optional(),
  phone: field,
  whatsapp: field,
  telegram: field,
  skype: field,
  email: field,
  other: field,
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;
  const editors = app.requireRole('admin', 'producer');

  app.get('/contacts', { preHandler: app.requireUser }, async (req, reply) => {
    const query = parseOr400(Query, req.query, reply);
    if (!query) return;
    const q = query.q ? `%${query.q.replace(/[%_]/g, '')}%` : null;
    const rows = await db
      .select()
      .from(contacts)
      .where(
        q
          ? or(ilike(contacts.displayName, q), ilike(contacts.phone, q), ilike(contacts.whatsapp, q), ilike(contacts.telegram, q), ilike(contacts.skype, q), ilike(contacts.email, q), ilike(contacts.notes, q))
          : undefined,
      )
      .orderBy(asc(contacts.displayName))
      .limit(300);
    return { contacts: rows };
  });

  app.post('/contacts', { preHandler: editors }, async (req, reply) => {
    const body = parseOr400(ContactBody, req.body, reply);
    if (!body) return;
    const { language, ...rest } = body;
    const [row] = await db
      .insert(contacts)
      .values({ ...rest, language: language ?? DEFAULT_LANGUAGE })
      .returning();
    return reply.code(201).send({ contact: row });
  });

  app.patch('/contacts/:id', { preHandler: editors }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(ContactBody.partial(), req.body, reply);
    if (!params || !body) return;
    const [row] = await db
      .update(contacts)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(contacts.id, params.id))
      .returning();
    if (!row) return notFound(reply, 'Contact');
    return { contact: row };
  });

  app.delete('/contacts/:id', { preHandler: editors }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [row] = await db.delete(contacts).where(eq(contacts.id, params.id)).returning({ id: contacts.id });
    if (!row) return notFound(reply, 'Contact');
    return { ok: true };
  });
}
