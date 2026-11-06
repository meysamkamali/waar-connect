// Small helpers shared by the route files.
import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';

/** Parses with a zod schema; on failure sends a 400 with the first issue and returns undefined. */
export function parseOr400<T>(schema: ZodType<T>, data: unknown, reply: FastifyReply): T | undefined {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  void reply.code(400).send({ error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.' });
  return undefined;
}

export function notFound(reply: FastifyReply, what: string): undefined {
  void reply.code(404).send({ error: `${what} not found.` });
  return undefined;
}
