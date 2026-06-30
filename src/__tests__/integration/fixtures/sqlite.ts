import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database } from "sql.js";

export const sqliteProjects = sqliteTable(
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

export type SqliteIntegrationDb = SQLJsDatabase<Record<string, never>>;

export type SqliteIntegrationHarness = {
  client: Database;
  db: SqliteIntegrationDb;
};

export async function createSqliteIntegrationDb(): Promise<SqliteIntegrationHarness> {
  const sqlJs = await initSqlJs();
  const client = new sqlJs.Database();
  const db = drizzle(client);

  client.run(`
    create table integration_projects (
      id text primary key,
      workspace_id text not null,
      slug text not null unique,
      name text not null,
      region_id text
    );
  `);

  return { client, db };
}

export async function seedSqliteProjects(db: SqliteIntegrationDb): Promise<void> {
  await db.insert(sqliteProjects).values([
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

export function closeSqliteIntegrationDb({ client }: SqliteIntegrationHarness): void {
  client.close();
}
