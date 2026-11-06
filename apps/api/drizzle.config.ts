import { defineConfig } from 'drizzle-kit';

// Migrations are generated offline from the schema (npm run db:generate) and applied with
// npm run db:migrate, which uses DATABASE_URL from .env.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
