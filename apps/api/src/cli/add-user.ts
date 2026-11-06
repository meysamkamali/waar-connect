// Creates or updates a producer, engineer or admin. There is no self sign-up.
//
//   PASSWORD='…' npm run user:add -- dilan@waar.tv "Dilan" producer
//
// Without PASSWORD a random one is generated and printed once.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password.ts';
import { loadConfig } from '../config.ts';
import { connectDb } from '../db/client.ts';
import { users } from '../db/schema.ts';

const [email, name, role] = process.argv.slice(2);
if (!email || !name || !role || !['admin', 'producer', 'engineer'].includes(role)) {
  console.error('usage: user:add <email> <name> <admin|producer|engineer>');
  process.exit(2);
}
const password = process.env['PASSWORD'] || randomBytes(9).toString('base64url');
const cfg = loadConfig();
const { db, close } = connectDb(cfg.DATABASE_URL);
const passwordHash = await hashPassword(password);
const values = { email: email.toLowerCase(), name, role: role as 'admin' | 'producer' | 'engineer', passwordHash, disabledAt: null };
const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, values.email)).limit(1);
if (existing) {
  await db.update(users).set(values).where(eq(users.id, existing.id));
  console.log(`updated ${values.email} (${role})`);
} else {
  await db.insert(users).values(values);
  console.log(`created ${values.email} (${role})`);
}
if (!process.env['PASSWORD']) console.log(`password: ${password}`);
await close();
