import { desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defaultProgramSettings, episodes, programs, type ProgramSettings } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';

const Settings = z.object({
  slots: z.int().min(1).max(16),
  readyRequired: z.boolean(),
  ifbAllowed: z.boolean(),
  languages: z.array(z.string().min(2).max(8)).min(1).max(8),
});
const CreateBody = z.object({ name: z.string().trim().min(1).max(80), settings: Settings.partial().optional() });
const PatchBody = z.object({ name: z.string().trim().min(1).max(80).optional(), settings: Settings.partial().optional() });
const Id = z.object({ id: z.uuid() });

type SettingsPatch = { [K in keyof ProgramSettings]?: ProgramSettings[K] | undefined };

/** Merges a partial settings patch, ignoring keys that were not sent. */
function mergeSettings(base: ProgramSettings, patch: SettingsPatch | undefined): ProgramSettings {
  const out: ProgramSettings = { ...base };
  if (!patch) return out;
  if (patch.slots !== undefined) out.slots = patch.slots;
  if (patch.readyRequired !== undefined) out.readyRequired = patch.readyRequired;
  if (patch.ifbAllowed !== undefined) out.ifbAllowed = patch.ifbAllowed;
  if (patch.languages !== undefined) out.languages = patch.languages;
  return out;
}

export async function programRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;
  const staff = app.requireRole('admin', 'producer');

  app.get('/programs', { preHandler: app.requireUser }, async () => {
    const rows = await db.select().from(programs).where(isNull(programs.archivedAt)).orderBy(programs.name);
    return { programs: rows };
  });

  app.post('/programs', { preHandler: staff }, async (req, reply) => {
    const body = parseOr400(CreateBody, req.body, reply);
    if (!body) return;
    const settings = mergeSettings(defaultProgramSettings(cfg.DEFAULT_SLOTS), body.settings);
    const [row] = await db.insert(programs).values({ name: body.name, settings }).returning();
    return reply.code(201).send({ program: row });
  });

  app.get('/programs/:id', { preHandler: app.requireUser }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [program] = await db.select().from(programs).where(eq(programs.id, params.id)).limit(1);
    if (!program) return notFound(reply, 'Program');
    const list = await db.select().from(episodes).where(eq(episodes.programId, program.id)).orderBy(desc(episodes.createdAt)).limit(50);
    return { program, episodes: list };
  });

  app.patch('/programs/:id', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(PatchBody, req.body, reply);
    if (!params || !body) return;
    const [current] = await db.select().from(programs).where(eq(programs.id, params.id)).limit(1);
    if (!current) return notFound(reply, 'Program');
    const [row] = await db
      .update(programs)
      .set({ name: body.name ?? current.name, settings: mergeSettings(current.settings, body.settings) })
      .where(eq(programs.id, params.id))
      .returning();
    return { program: row };
  });

  app.post('/programs/:id/archive', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [row] = await db.update(programs).set({ archivedAt: new Date() }).where(eq(programs.id, params.id)).returning();
    if (!row) return notFound(reply, 'Program');
    return { program: row };
  });
}
