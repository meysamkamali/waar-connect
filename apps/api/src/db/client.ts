import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = PostgresJsDatabase<typeof schema>;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

export function connectDb(url: string): Database {
  const sql = postgres(url, { max: 10, onnotice: () => undefined });
  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}
