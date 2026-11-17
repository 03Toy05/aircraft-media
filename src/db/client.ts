import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const MIGRATIONS = path.resolve(process.cwd(), "drizzle");

/** Fresh in-memory database with all migrations applied. Used by tests. */
export async function createMemoryDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

const g = globalThis as unknown as { __aircraftDb?: Promise<Db> };

/**
 * Application database. DATABASE_URL => PostgreSQL (Render).
 * Otherwise an embedded PGlite persisted under .data/pglite for local development.
 */
export function getDb(): Promise<Db> {
  if (!g.__aircraftDb) {
    g.__aircraftDb = (async () => {
      if (process.env.DATABASE_URL) {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const db = drizzlePg(pool, { schema });
        await migratePg(db, { migrationsFolder: MIGRATIONS });
        return db as unknown as Db;
      }
      const dataDir = path.resolve(process.cwd(), ".data/pglite");
      fs.mkdirSync(path.dirname(dataDir), { recursive: true }); // PGlite only creates the last path segment
      const client = new PGlite(dataDir);
      const db = drizzlePglite(client, { schema });
      await migratePglite(db, { migrationsFolder: MIGRATIONS });
      return db as unknown as Db;
    })();
  }
  return g.__aircraftDb;
}
