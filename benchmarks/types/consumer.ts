/**
 * Fixed consumer workload for the type-check benchmark. It exercises the public scoped surface the
 * way an application would (whole-row and projected selects, joins, ordering, mutations with
 * returning, and transactions) on both PostgreSQL and SQLite so `tsc --extendedDiagnostics` measures
 * the type-level cost callers pay. Keep it stable: changing the workload invalidates comparisons
 * against committed snapshots.
 */
import { eq, sql } from "drizzle-orm";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

import type { ScopedDb } from "../../src/index";

const pgProjects = pgTable("benchmark_projects", {
  id: pgText("id").primaryKey(),
  workspaceId: pgText("workspace_id").notNull(),
  slug: pgText("slug").notNull(),
  name: pgText("name").notNull(),
  regionId: pgText("region_id"),
});

const pgTasks = pgTable("benchmark_tasks", {
  id: pgText("id").primaryKey(),
  projectId: pgText("project_id").notNull(),
  workspaceId: pgText("workspace_id").notNull(),
  title: pgText("title").notNull(),
});

const pgNotes = pgTable("benchmark_notes", {
  id: pgText("id").primaryKey(),
  taskId: pgText("task_id").notNull(),
  body: pgText("body").notNull(),
});

const sqliteProjects = sqliteTable("benchmark_projects", {
  id: sqliteText("id").primaryKey(),
  workspaceId: sqliteText("workspace_id").notNull(),
  slug: sqliteText("slug").notNull(),
  name: sqliteText("name").notNull(),
  regionId: sqliteText("region_id"),
});

const sqliteTasks = sqliteTable("benchmark_tasks", {
  id: sqliteText("id").primaryKey(),
  projectId: sqliteText("project_id").notNull(),
  workspaceId: sqliteText("workspace_id").notNull(),
  title: sqliteText("title").notNull(),
});

type PgDb = ScopedDb<PgliteDatabase<Record<string, never>>, string>;
type SqliteDb = ScopedDb<SQLJsDatabase<Record<string, never>>, string>;

export const consumerWorkload = async (pg: PgDb, lite: SqliteDb) => {
  const wholeRows = await pg.select().from(pgProjects).where(eq(pgProjects.workspaceId, "w"));
  const projected = await pg
    .select({ id: pgProjects.id, name: pgProjects.name })
    .from(pgProjects)
    .where(sql``);
  const wholeRowJoin = await pg
    .select()
    .from(pgProjects)
    .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
    .where(sql``);
  const chainedJoin = await pg
    .select({
      projectId: pgProjects.id,
      taskId: pgTasks.id,
      task: { id: pgTasks.id, title: pgTasks.title },
    })
    .from(pgProjects)
    .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
    .innerJoin(pgNotes, eq(pgNotes.taskId, pgTasks.id))
    .where(sql``)
    .orderBy(pgProjects.name)
    .limit(10);
  const aggregate = await pg
    .select({ count: sql<number>`count(*)` })
    .from(pgProjects)
    .where(sql``);
  const inserted = await pg
    .insert(pgProjects)
    .values({ id: "p", workspaceId: "w", slug: "s", name: "n" })
    .returning();
  const insertedMany = await pg
    .insert(pgProjects)
    .values([{ id: "p", workspaceId: "w", slug: "s", name: "n" }])
    .returning({ id: pgProjects.id });
  const updated = await pg
    .update(pgProjects)
    .set({ name: "x" })
    .where(eq(pgProjects.id, "p"))
    .returning();
  const deleted = await pg.delete(pgProjects).where(eq(pgProjects.id, "p"));
  const liteRows = await lite
    .select()
    .from(sqliteProjects)
    .where(sql``);
  const liteJoin = await lite
    .select({ id: sqliteProjects.id, title: sqliteTasks.title })
    .from(sqliteProjects)
    .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
    .where(sql``);
  const liteInserted = await lite
    .insert(sqliteProjects)
    .values({ id: "p", workspaceId: "w", slug: "s", name: "n" })
    .returning();
  const liteUpdated = await lite
    .update(sqliteProjects)
    .set({ name: "x" })
    .where(sql``);
  const inTransaction = await pg.transaction(async (tx) =>
    tx
      .select()
      .from(pgProjects)
      .where(sql``),
  );

  return [
    wholeRows,
    projected,
    wholeRowJoin,
    chainedJoin,
    aggregate,
    inserted,
    insertedMany,
    updated,
    deleted,
    liteRows,
    liteJoin,
    liteInserted,
    liteUpdated,
    inTransaction,
  ] as const;
};
