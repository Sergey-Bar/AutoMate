import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/automate';

export const pgClient = postgres(connectionString, { max: 10 });

export const db = drizzle(pgClient, { schema });

export async function closeDb(): Promise<void> {
  await pgClient.end();
}
