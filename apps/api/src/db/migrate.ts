// Applies the SQL migrations in ../../drizzle. Run as: npm run db:migrate
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig } from '../config.ts';
import { connectDb } from './client.ts';

const cfg = loadConfig();
const { db, close } = connectDb(cfg.DATABASE_URL);
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
await migrate(db, { migrationsFolder });
await close();
console.log('migrations applied from', migrationsFolder);
