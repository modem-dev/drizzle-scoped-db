import { describe, expectTypeOf, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { alias as sqliteAlias } from "drizzle-orm/sqlite-core";

import {
  scopeByColumn,
  scopeByPredicate,
  type InferSelection,
  type ScopedDb,
} from "../../src/index";
import {
  pgProjects,
  pgTasks,
  pgWithNotes,
  type PgIntegrationDb,
} from "../integration/fixtures/postgres";
import {
  sqliteNotes,
  sqliteProjects,
  sqliteTasks,
  type SqliteIntegrationDb,
} from "../integration/fixtures/sqlite";
import type { SQL } from "./fixtures";

type PgScopedDb = ScopedDb<PgliteDatabase<Record<string, never>>, string>;
type SqliteScopedDb = ScopedDb<SQLJsDatabase<Record<string, never>>, string>;

describe("public type surface", () => {
  it("allows specifying only the scope type for callback-based rule helpers", () => {
    const columnRule = scopeByColumn<{ workspaceId: string }>(pgProjects, {
      workspaceId: {
        column: pgProjects.workspaceId,
        value: (scope) => scope.workspaceId,
      },
    });
    const predicateRule = scopeByPredicate<{ workspaceId: string }>(pgProjects, {
      where: (scope) => eq(pgProjects.workspaceId, scope.workspaceId),
      strictColumns: [pgProjects.workspaceId],
    });

    void [columnRule, predicateRule];
  });

  it("gates selectDistinctOn by real dialect DB types", () => {
    expectTypeOf<PgScopedDb["selectDistinctOn"]>().toBeFunction();
    expectTypeOf<SqliteScopedDb["selectDistinctOn"]>().toEqualTypeOf<undefined>();
  });

  it("preserves column nullability in explicit select projections", () => {
    type Projection = InferSelection<{
      name: typeof pgProjects.name;
      regionId: typeof pgProjects.regionId;
      nested: { regionId: typeof pgProjects.regionId };
    }>;

    expectTypeOf<Projection>().toEqualTypeOf<{
      name: string;
      regionId: string | null;
      nested: { regionId: string | null };
    }>();

    const _assertScopedProjection = async (db: PgScopedDb) => {
      const rows = await db
        .select({
          name: pgProjects.name,
          regionId: pgProjects.regionId,
          nested: { regionId: pgProjects.regionId },
        })
        .from(pgProjects)
        .where(eq(pgProjects.workspaceId, "workspace-1"));

      expectTypeOf(rows).toEqualTypeOf<Projection[]>();
    };
    void _assertScopedProjection;
  });

  it("matches Drizzle nullability for explicit left-join projections", () => {
    type LeftJoinRows = {
      projectId: string;
      taskId: string | null;
      task: { id: string; title: string } | null;
    }[];
    type InnerJoinRows = {
      projectId: string;
      taskId: string;
      task: { id: string; title: string };
    }[];

    const _assertPgLeftJoin = async (rawDb: PgIntegrationDb, scopedDb: PgScopedDb) => {
      const selection = {
        projectId: pgProjects.id,
        taskId: pgTasks.id,
        task: { id: pgTasks.id, title: pgTasks.title },
      };
      const rawRows = await rawDb
        .select(selection)
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));
      const scopedRows = await scopedDb
        .select(selection)
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .where(eq(pgProjects.workspaceId, "workspace-1"));

      expectTypeOf(rawRows).toEqualTypeOf<LeftJoinRows>();
      expectTypeOf(scopedRows).toEqualTypeOf<LeftJoinRows>();

      const innerJoinRows = await scopedDb
        .select(selection)
        .from(pgProjects)
        .innerJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .where(eq(pgProjects.workspaceId, "workspace-1"));
      expectTypeOf(innerJoinRows).toEqualTypeOf<InnerJoinRows>();
    };

    const _assertSqliteLeftJoin = async (rawDb: SqliteIntegrationDb, scopedDb: SqliteScopedDb) => {
      const selection = {
        projectId: sqliteProjects.id,
        taskId: sqliteTasks.id,
        task: { id: sqliteTasks.id, title: sqliteTasks.title },
      };
      const rawRows = await rawDb
        .select(selection)
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id));
      const scopedRows = await scopedDb
        .select(selection)
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .where(eq(sqliteProjects.workspaceId, "workspace-1"));

      expectTypeOf(rawRows).toEqualTypeOf<LeftJoinRows>();
      expectTypeOf(scopedRows).toEqualTypeOf<LeftJoinRows>();

      const innerJoinRows = await scopedDb
        .select(selection)
        .from(sqliteProjects)
        .innerJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .where(eq(sqliteProjects.workspaceId, "workspace-1"));
      expectTypeOf(innerJoinRows).toEqualTypeOf<InnerJoinRows>();
    };

    void [_assertPgLeftJoin, _assertSqliteLeftJoin];
  });

  it("accumulates join nullability across chained joins and mixed-table nested objects", () => {
    type ChainedRows = {
      projectId: string;
      taskId: string | null;
      noteId: string;
      detail: { taskTitle: string | null; projectName: string };
    }[];

    const _assertPgChainedJoins = async (rawDb: PgIntegrationDb, scopedDb: PgScopedDb) => {
      const selection = {
        projectId: pgProjects.id,
        taskId: pgTasks.id,
        noteId: pgWithNotes.id,
        detail: { taskTitle: pgTasks.title, projectName: pgProjects.name },
      };
      const rawRows = await rawDb
        .select(selection)
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .innerJoin(pgWithNotes, eq(pgWithNotes.taskId, pgTasks.id));
      const scopedRows = await scopedDb
        .select(selection)
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .innerJoin(pgWithNotes, eq(pgWithNotes.taskId, pgTasks.id))
        .where(eq(pgProjects.workspaceId, "workspace-1"));

      expectTypeOf(rawRows).toEqualTypeOf<ChainedRows>();
      expectTypeOf(scopedRows).toEqualTypeOf<ChainedRows>();
    };

    const _assertSqliteChainedJoins = async (
      rawDb: SqliteIntegrationDb,
      scopedDb: SqliteScopedDb,
    ) => {
      const selection = {
        projectId: sqliteProjects.id,
        taskId: sqliteTasks.id,
        noteId: sqliteNotes.id,
        detail: { taskTitle: sqliteTasks.title, projectName: sqliteProjects.name },
      };
      const rawRows = await rawDb
        .select(selection)
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .innerJoin(sqliteNotes, eq(sqliteNotes.taskId, sqliteTasks.id));
      const scopedRows = await scopedDb
        .select(selection)
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .innerJoin(sqliteNotes, eq(sqliteNotes.taskId, sqliteTasks.id))
        .where(eq(sqliteProjects.workspaceId, "workspace-1"));

      expectTypeOf(rawRows).toEqualTypeOf<ChainedRows>();
      expectTypeOf(scopedRows).toEqualTypeOf<ChainedRows>();
    };

    void [_assertPgChainedJoins, _assertSqliteChainedJoins];
  });

  it("matches Drizzle nullability when joining aliased tables", () => {
    const _assertPgAliasJoin = async (rawDb: PgIntegrationDb, scopedDb: PgScopedDb) => {
      const parentTask = pgAlias(pgTasks, "parent_task");
      const selection = { taskId: pgTasks.id, parentTitle: parentTask.title };
      const rawRows = await rawDb
        .select(selection)
        .from(pgTasks)
        .leftJoin(parentTask, eq(parentTask.projectId, pgTasks.projectId));
      const scopedRows = await scopedDb
        .select(selection)
        .from(pgTasks)
        .leftJoin(parentTask, eq(parentTask.projectId, pgTasks.projectId))
        .where(eq(pgTasks.workspaceId, "workspace-1"));

      expectTypeOf(scopedRows).toEqualTypeOf(rawRows);
      expectTypeOf(scopedRows).toEqualTypeOf<{ taskId: string; parentTitle: string | null }[]>();

      const rawWholeRows = await rawDb
        .select()
        .from(pgTasks)
        .leftJoin(parentTask, eq(parentTask.projectId, pgTasks.projectId));
      const scopedWholeRows = await scopedDb
        .select()
        .from(pgTasks)
        .leftJoin(parentTask, eq(parentTask.projectId, pgTasks.projectId))
        .where(eq(pgTasks.workspaceId, "workspace-1"));
      expectTypeOf(scopedWholeRows).toEqualTypeOf(rawWholeRows);
      expectTypeOf<(typeof scopedWholeRows)[number]["parent_task"]>().toEqualTypeOf<
        typeof pgTasks.$inferSelect | null
      >();
    };

    const _assertSqliteAliasJoin = async (rawDb: SqliteIntegrationDb, scopedDb: SqliteScopedDb) => {
      const parentTask = sqliteAlias(sqliteTasks, "parent_task");
      const selection = { taskId: sqliteTasks.id, parentTitle: parentTask.title };
      const rawRows = await rawDb
        .select(selection)
        .from(sqliteTasks)
        .leftJoin(parentTask, eq(parentTask.projectId, sqliteTasks.projectId));
      const scopedRows = await scopedDb
        .select(selection)
        .from(sqliteTasks)
        .leftJoin(parentTask, eq(parentTask.projectId, sqliteTasks.projectId))
        .where(eq(sqliteTasks.workspaceId, "workspace-1"));

      expectTypeOf(scopedRows).toEqualTypeOf(rawRows);
      expectTypeOf(scopedRows).toEqualTypeOf<{ taskId: string; parentTitle: string | null }[]>();
    };

    void [_assertPgAliasJoin, _assertSqliteAliasJoin];
  });

  it("matches Drizzle's nested row shape for whole-row selects with joins", () => {
    type ProjectRow = typeof pgProjects.$inferSelect;
    type TaskRow = typeof pgTasks.$inferSelect;
    type NoteRow = typeof pgWithNotes.$inferSelect;

    const _assertPgWholeRowJoins = async (rawDb: PgIntegrationDb, scopedDb: PgScopedDb) => {
      const rawRows = await rawDb.select().from(pgProjects);
      const scopedRows = await scopedDb
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedRows).toEqualTypeOf(rawRows);
      expectTypeOf(scopedRows).toEqualTypeOf<ProjectRow[]>();

      const rawLeftJoin = await rawDb
        .select()
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));
      const scopedLeftJoin = await scopedDb
        .select()
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .where(eq(pgProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedLeftJoin).toEqualTypeOf(rawLeftJoin);
      expectTypeOf(scopedLeftJoin).toEqualTypeOf<
        { integration_projects: ProjectRow; integration_tasks: TaskRow | null }[]
      >();

      const rawChained = await rawDb
        .select()
        .from(pgProjects)
        .innerJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .leftJoin(pgWithNotes, eq(pgWithNotes.taskId, pgTasks.id));
      const scopedChained = await scopedDb
        .select()
        .from(pgProjects)
        .innerJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .leftJoin(pgWithNotes, eq(pgWithNotes.taskId, pgTasks.id))
        .where(eq(pgProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedChained).toEqualTypeOf(rawChained);
      expectTypeOf(scopedChained).toEqualTypeOf<
        {
          integration_projects: ProjectRow;
          integration_tasks: TaskRow;
          with_notes: NoteRow | null;
        }[]
      >();
    };

    const _assertSqliteWholeRowJoins = async (
      rawDb: SqliteIntegrationDb,
      scopedDb: SqliteScopedDb,
    ) => {
      const rawRows = await rawDb.select().from(sqliteProjects);
      const scopedRows = await scopedDb
        .select()
        .from(sqliteProjects)
        .where(eq(sqliteProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedRows).toEqualTypeOf(rawRows);

      const rawLeftJoin = await rawDb
        .select()
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id));
      const scopedLeftJoin = await scopedDb
        .select()
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .where(eq(sqliteProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedLeftJoin).toEqualTypeOf(rawLeftJoin);

      const rawChained = await rawDb
        .select()
        .from(sqliteProjects)
        .innerJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .leftJoin(sqliteNotes, eq(sqliteNotes.taskId, sqliteTasks.id));
      const scopedChained = await scopedDb
        .select()
        .from(sqliteProjects)
        .innerJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id))
        .leftJoin(sqliteNotes, eq(sqliteNotes.taskId, sqliteTasks.id))
        .where(eq(sqliteProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedChained).toEqualTypeOf(rawChained);
    };

    void [_assertPgWholeRowJoins, _assertSqliteWholeRowJoins];
  });

  it("infers explicit projections identically before and after joins", () => {
    const _assertConsistentInference = async (rawDb: PgIntegrationDb, scopedDb: PgScopedDb) => {
      // Whole-table entries and sql fragments resolve through Drizzle's own inference in both positions.
      const rootSelection = {
        project: pgProjects,
        upper: sql<string>`upper(${pgProjects.name})`,
        lowered: sql<string>`lower(${pgProjects.name})`.as("lowered"),
      };
      const selection = { ...rootSelection, taskId: pgTasks.id };

      const rawBeforeJoin = await rawDb.select(rootSelection).from(pgProjects);
      const scopedBeforeJoin = await scopedDb
        .select(rootSelection)
        .from(pgProjects)
        .where(eq(pgProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedBeforeJoin).toEqualTypeOf(rawBeforeJoin);

      const rawAfterJoin = await rawDb
        .select(selection)
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));
      const scopedAfterJoin = await scopedDb
        .select(selection)
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id))
        .where(eq(pgProjects.workspaceId, "workspace-1"));
      expectTypeOf(scopedAfterJoin).toEqualTypeOf(rawAfterJoin);
      type AfterJoinRow = (typeof scopedAfterJoin)[number];
      expectTypeOf<AfterJoinRow["project"]>().toEqualTypeOf<typeof pgProjects.$inferSelect>();
      expectTypeOf<AfterJoinRow["taskId"]>().toEqualTypeOf<string | null>();
    };

    void _assertConsistentInference;
  });

  it("preserves returning projection types for real PostgreSQL and SQLite database types", () => {
    const _assertReturningTypes = async (pgDb: PgScopedDb, sqliteDb: SqliteScopedDb) => {
      const pgRows = await pgDb
        .insert(pgProjects)
        .values({ id: "p", workspaceId: "w", slug: "p", name: "Project" })
        .returning({ id: pgProjects.id });
      expectTypeOf(pgRows).toEqualTypeOf<{ id: string }[]>();

      const sqliteRows = await sqliteDb
        .insert(sqliteProjects)
        .values({ id: "p", workspaceId: "w", slug: "p", name: "Project" })
        .returning({ id: sqliteProjects.id });
      expectTypeOf(sqliteRows).toEqualTypeOf<{ id: string }[]>();
    };
    void _assertReturningTypes;
  });

  it("preserves transaction callback modes for real sync and async dialect types", () => {
    const _assertTransactionModes = (pgDb: PgScopedDb, sqliteDb: SqliteScopedDb) => {
      pgDb.transaction(async (tx) => {
        tx.select().from(pgProjects);
        return "ok";
      });
      sqliteDb.transaction((tx) => {
        tx.select().from(sqliteProjects);
        return "ok";
      });
      // @ts-expect-error SQL.js transactions are synchronous; async callbacks cannot roll back after await.
      sqliteDb.transaction(async () => "unsafe");
    };
    void _assertTransactionModes;
  });

  it("preserves custom properties and extensions on root and transaction handles", () => {
    type Scope = { workspaceId: string };
    type Extensions = { assertWorkspace(expected: string): void };
    type CustomScopedDb = ScopedDb<
      PgliteDatabase<Record<string, never>>,
      Scope,
      Extensions,
      "_raw",
      "workspace"
    >;

    const _assertCustomSurface = async (db: CustomScopedDb) => {
      expectTypeOf(db._raw).toEqualTypeOf<PgliteDatabase<Record<string, never>>>();
      expectTypeOf(db.workspace).toEqualTypeOf<Scope>();
      db.assertWorkspace("workspace-1");

      await db.transaction(async (tx) => {
        expectTypeOf(tx._raw).toEqualTypeOf<PgliteDatabase<Record<string, never>>>();
        expectTypeOf(tx.workspace).toEqualTypeOf<Scope>();
        tx.assertWorkspace("workspace-1");
      });
    };
    void _assertCustomSurface;
  });

  it("keeps scoped builders narrow for real dialect DB types", () => {
    const _assertNarrowBuilders = (db: PgScopedDb) => {
      const selectBuilder = db.select().from(pgProjects);
      selectBuilder.where(undefined);
      // @ts-expect-error Scoped select builders do not expose raw Drizzle prepare().
      void selectBuilder.prepare;

      const distinctBuilder = db.selectDistinct({ id: pgProjects.id }).from(pgProjects);
      distinctBuilder.where(undefined);
      // @ts-expect-error Scoped distinct select builders do not expose raw Drizzle as().
      void distinctBuilder.as;

      const insertResult = db
        .insert(pgProjects)
        .values({ id: "p", workspaceId: "w", slug: "p", name: "Project" });
      insertResult.returning({ id: pgProjects.id });
      // @ts-expect-error Raw MySQL upsert helpers are intentionally not exposed on scoped results.
      void insertResult.onDuplicateKeyUpdate;

      const updateResult = db.update(pgProjects).set({ name: "Updated" }).where(undefined);
      updateResult.returning({ id: pgProjects.id });
      // @ts-expect-error Scoped mutation results do not expose raw query-builder chaining.
      void updateResult.where;
    };
    void _assertNarrowBuilders;
  });

  it("keeps MySQL-style mutation methods dialect gated", () => {
    type MySqlLikeDb = {
      insert(table: unknown): {
        values(values: unknown): {
          rowsAffected: number;
          $returningId(): { id: number }[];
          onDuplicateKeyUpdate(config: unknown): unknown;
        };
      };
      update(table: unknown): {
        set(values: Record<string, unknown>): {
          where(condition: SQL | undefined): { rowsAffected: number };
        };
      };
      delete(table: unknown): { where(condition: SQL | undefined): { rowsAffected: number } };
    };

    const _assertMySqlSurface = (db: ScopedDb<MySqlLikeDb, string>) => {
      const insertResult = db
        .insert(pgProjects)
        .values({ id: "p", workspaceId: "w", slug: "p", name: "Project" });
      expectTypeOf(insertResult.$returningId()).toEqualTypeOf<{ id: number }[]>();
      insertResult.$unsafeUnscoped().onDuplicateKeyUpdate({ set: {} });

      // @ts-expect-error MySQL-style scoped inserts have no RETURNING clause.
      void insertResult.returning;
      // @ts-expect-error MySQL's targetless upsert helper requires the unsafe transition.
      void insertResult.onDuplicateKeyUpdate;
      // @ts-expect-error MySQL-style scoped updates have no RETURNING clause.
      void db.update(pgProjects).set({ name: "Updated" }).where(undefined).returning;
      // @ts-expect-error MySQL-style scoped deletes have no RETURNING clause.
      void db.delete(pgProjects).where(undefined).returning;
    };
    void _assertMySqlSurface;
  });
});
