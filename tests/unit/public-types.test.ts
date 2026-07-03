import { describe, expectTypeOf, it } from "vitest";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";

import type { ScopedDb } from "../../src/index";
import { pgProjects } from "../integration/fixtures/postgres";
import { sqliteProjects } from "../integration/fixtures/sqlite";
import type { SQL } from "./fixtures";

type PgScopedDb = ScopedDb<PgliteDatabase<Record<string, never>>, string>;
type SqliteScopedDb = ScopedDb<SQLJsDatabase<Record<string, never>>, string>;

describe("public type surface", () => {
  it("gates selectDistinctOn by real dialect DB types", () => {
    expectTypeOf<PgScopedDb["selectDistinctOn"]>().toBeFunction();
    expectTypeOf<SqliteScopedDb["selectDistinctOn"]>().toEqualTypeOf<undefined>();
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
