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

export const sqliteTasks = sqliteTable("integration_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
});

export const sqliteNotes = sqliteTable("integration_notes", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  body: text("body").notNull(),
});

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

    create table integration_tasks (
      id text primary key,
      project_id text not null,
      workspace_id text not null,
      title text not null
    );

    create table integration_notes (
      id text primary key,
      task_id text not null,
      body text not null
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

/** Adds an in-scope project with no tasks, so left joins yield a `null` joined row for it. */
export async function seedSqliteUntaskedProject(db: SqliteIntegrationDb): Promise<void> {
  await db.insert(sqliteProjects).values({
    id: "project-3",
    workspaceId: "workspace-1",
    slug: "project-3",
    name: "No in-scope tasks",
  });
}

export async function seedSqliteTasks(db: SqliteIntegrationDb): Promise<void> {
  await db.insert(sqliteTasks).values([
    {
      id: "task-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      title: "In-scope task",
    },
    {
      id: "task-2",
      projectId: "project-1",
      workspaceId: "workspace-2",
      title: "Mismatched workspace task",
    },
    {
      id: "task-3",
      projectId: "project-2",
      workspaceId: "workspace-2",
      title: "Other workspace task",
    },
    {
      id: "task-4",
      projectId: "project-3",
      workspaceId: "workspace-2",
      title: "Only out-of-scope task",
    },
  ]);
}

export function closeSqliteIntegrationDb({ client }: SqliteIntegrationHarness): void {
  client.close();
}
