import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const pgProjects = pgTable(
  "integration_projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    regionId: text("region_id"),
  },
  (table) => [uniqueIndex("integration_projects_slug_unique").on(table.slug)],
);

export type PgIntegrationDb = PgliteDatabase<Record<string, never>> & { $client: PGlite };

export async function createPgIntegrationDb(): Promise<PgIntegrationDb> {
  const client = new PGlite();
  const db = drizzle({ client });

  await db.execute(
    sql.raw(`
    create table integration_projects (
      id text primary key,
      workspace_id text not null,
      slug text not null unique,
      name text not null,
      region_id text
    );
  `),
  );

  return db;
}

export async function seedPgProjects(db: PgIntegrationDb): Promise<void> {
  await db.insert(pgProjects).values([
    {
      id: "project-1",
      workspaceId: "workspace-1",
      slug: "project-1",
      name: "Roadmap",
      regionId: "us-east-1",
    },
    {
      id: "project-2",
      workspaceId: "workspace-2",
      slug: "project-2",
      name: "Other workspace",
      regionId: "us-west-2",
    },
  ]);
}

export async function closePgIntegrationDb(db: PgIntegrationDb): Promise<void> {
  await db.$client.close();
}
