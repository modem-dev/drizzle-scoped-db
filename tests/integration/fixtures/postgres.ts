import { PGlite } from "@electric-sql/pglite";
import { relations, type SQL, sql } from "drizzle-orm";
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

export const pgTasks = pgTable("integration_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
});

export type PgIntegrationDb = PgliteDatabase<Record<string, never>> & { $client: PGlite };

const PROJECTS_DDL = `
    create table integration_projects (
      id text primary key,
      workspace_id text not null,
      slug text not null unique,
      name text not null,
      region_id text
    );
  `;

const TASKS_DDL = `
    create table integration_tasks (
      id text primary key,
      project_id text not null,
      workspace_id text not null,
      title text not null
    );
  `;

export async function createPgIntegrationDb(): Promise<PgIntegrationDb> {
  const client = new PGlite();
  const db = drizzle({ client });

  await createPgIntegrationSchema(db);

  return db;
}

/**
 * Relational-query schema whose KEY (the Drizzle `tsName`) deliberately differs from the table's
 * SQL name (`integration_projects`). Drizzle's relational query API aliases callback columns to
 * this key, mirroring real consumer schemas like `{ groupsTbl: pgTable("groups", ...) }`.
 */
export const pgRelationalSchema = { projectsTbl: pgProjects };

/**
 * Minimal relational-query surface the regression test needs, typed locally so the fixture builds
 * across Drizzle's locked and release-candidate dependency matrices (the relational-query generics
 * differ between versions). The runtime method is still Drizzle's own.
 */
export type PgRelationalDb = PgIntegrationDb & {
  query: {
    projectsTbl: {
      findMany(config: {
        where: (
          columns: { id: unknown; workspaceId: unknown },
          operators: { eq: (left: unknown, right: unknown) => SQL },
        ) => SQL | undefined;
      }): Promise<Array<typeof pgProjects.$inferSelect>>;
    };
  };
};

export type PgRqbV2RelationalDb = PgIntegrationDb & {
  query: {
    projectsTbl: {
      findMany(config?: {
        where?: Record<string, unknown>;
      }): Promise<Array<typeof pgProjects.$inferSelect>>;
    };
  };
};

export async function createPgRelationalDb(): Promise<PgRelationalDb> {
  const client = new PGlite();
  // Cast through the bare drizzle signature: the typed schema overload differs across Drizzle
  // versions, but the runtime relational query API is the same. The returned db is given the
  // explicit PgRelationalDb shape above.
  const makeDb = drizzle as unknown as (config: {
    client: PGlite;
    schema: typeof pgRelationalSchema;
  }) => PgIntegrationDb;
  const db = makeDb({ client, schema: pgRelationalSchema });

  await createPgIntegrationSchema(db);

  return db as unknown as PgRelationalDb;
}

export async function createPgRqbV2RelationalDb(): Promise<PgRqbV2RelationalDb> {
  const relationsModule = (await import("drizzle-orm/relations")) as Record<string, unknown>;
  const defineRelations = relationsModule.defineRelations as
    | ((schema: typeof pgRelationalSchema, relations: () => Record<string, never>) => unknown)
    | undefined;
  if (!defineRelations) {
    throw new Error("Drizzle RQBv2 defineRelations is not available.");
  }

  const client = new PGlite();
  const makeDb = drizzle as unknown as (config: {
    client: PGlite;
    relations: unknown;
  }) => PgIntegrationDb;
  const db = makeDb({ client, relations: defineRelations(pgRelationalSchema, () => ({})) });

  await createPgIntegrationSchema(db);

  return db as unknown as PgRqbV2RelationalDb;
}

async function createPgIntegrationSchema(db: Pick<PgIntegrationDb, "execute">): Promise<void> {
  await db.execute(sql.raw(PROJECTS_DDL));
  await db.execute(sql.raw(TASKS_DDL));
}

// A relational schema with real Drizzle `relations()` so nested `with` includes can be scoped:
// projects → tasks (scoped by workspace) and tasks → notes (an unscoped child, no rule).
export const pgWithProjects = pgTable("with_projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
});

export const pgWithTasks = pgTable("with_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
});

export const pgWithNotes = pgTable("with_notes", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  body: text("body").notNull(),
});

const pgWithProjectsRelations = relations(pgWithProjects, ({ many }) => ({
  tasks: many(pgWithTasks),
}));

const pgWithTasksRelations = relations(pgWithTasks, ({ one, many }) => ({
  project: one(pgWithProjects, {
    fields: [pgWithTasks.projectId],
    references: [pgWithProjects.id],
  }),
  notes: many(pgWithNotes),
}));

const pgWithNotesRelations = relations(pgWithNotes, ({ one }) => ({
  task: one(pgWithTasks, { fields: [pgWithNotes.taskId], references: [pgWithTasks.id] }),
}));

export const pgWithRelationalSchema = {
  projectsTbl: pgWithProjects,
  tasksTbl: pgWithTasks,
  notesTbl: pgWithNotes,
  pgWithProjectsRelations,
  pgWithTasksRelations,
  pgWithNotesRelations,
};

type WithRelationsConfig = {
  where?: (
    columns: Record<string, unknown>,
    operators: { eq: (left: unknown, right: unknown) => SQL },
  ) => SQL | undefined;
  with?: Record<string, unknown>;
};

type WithRelationalTableQuery = {
  findMany(config?: WithRelationsConfig): Promise<Array<Record<string, unknown>>>;
  findFirst(config?: WithRelationsConfig): Promise<Record<string, unknown> | undefined>;
};

export type PgWithRelationalDb = PgIntegrationDb & {
  query: {
    projectsTbl: WithRelationalTableQuery;
    tasksTbl: WithRelationalTableQuery;
    notesTbl: WithRelationalTableQuery;
  };
};

const WITH_PROJECTS_DDL = `
    create table with_projects (
      id text primary key,
      workspace_id text not null,
      name text not null
    );
  `;

const WITH_TASKS_DDL = `
    create table with_tasks (
      id text primary key,
      project_id text not null,
      workspace_id text not null,
      title text not null
    );
  `;

const WITH_NOTES_DDL = `
    create table with_notes (
      id text primary key,
      task_id text not null,
      body text not null
    );
  `;

export async function createPgWithRelationalDb(): Promise<PgWithRelationalDb> {
  const client = new PGlite();
  const makeDb = drizzle as unknown as (config: {
    client: PGlite;
    schema: typeof pgWithRelationalSchema;
  }) => PgIntegrationDb;
  const db = makeDb({ client, schema: pgWithRelationalSchema });

  await db.execute(sql.raw(WITH_PROJECTS_DDL));
  await db.execute(sql.raw(WITH_TASKS_DDL));
  await db.execute(sql.raw(WITH_NOTES_DDL));

  return db as unknown as PgWithRelationalDb;
}

/**
 * Seed two workspaces. Project-1 belongs to workspace-1; task-2 is a cross-workspace row hanging off
 * project-1 so nested `with` scoping can be shown to exclude it. Notes are unscoped (no workspace).
 */
export async function seedPgWithRelations(db: Pick<PgIntegrationDb, "insert">): Promise<void> {
  await db.insert(pgWithProjects).values([
    { id: "project-1", workspaceId: "workspace-1", name: "Roadmap" },
    { id: "project-2", workspaceId: "workspace-2", name: "Other workspace" },
  ]);
  await db.insert(pgWithTasks).values([
    { id: "task-1", projectId: "project-1", workspaceId: "workspace-1", title: "In-scope task" },
    {
      id: "task-2",
      projectId: "project-1",
      workspaceId: "workspace-2",
      title: "Cross-workspace task",
    },
    {
      id: "task-3",
      projectId: "project-2",
      workspaceId: "workspace-2",
      title: "Other workspace task",
    },
  ]);
  await db.insert(pgWithNotes).values([
    { id: "note-1", taskId: "task-1", body: "First note" },
    { id: "note-2", taskId: "task-1", body: "Second note" },
    // note-3 hangs off task-3, which belongs to workspace-2 (out of scope for workspace-1).
    { id: "note-3", taskId: "task-3", body: "Cross-workspace note" },
  ]);
}

export async function seedPgProjects(db: Pick<PgIntegrationDb, "insert">): Promise<void> {
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

export async function seedPgTasks(db: Pick<PgIntegrationDb, "insert">): Promise<void> {
  await db.insert(pgTasks).values([
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

export async function closePgIntegrationDb(db: Pick<PgIntegrationDb, "$client">): Promise<void> {
  await db.$client.close();
}
