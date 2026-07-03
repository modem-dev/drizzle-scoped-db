import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

import { type ScopedDb, scopeByColumn } from "../../dist/index.js";

const pgProjects = pgTable("consumer_pg_projects", {
  id: pgText("id").primaryKey(),
  workspaceId: pgText("workspace_id").notNull(),
  name: pgText("name").notNull(),
});

const sqliteProjects = sqliteTable("consumer_sqlite_projects", {
  id: sqliteText("id").primaryKey(),
  workspaceId: sqliteText("workspace_id").notNull(),
  name: sqliteText("name").notNull(),
});

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type PgScopedDb = ScopedDb<PgliteDatabase<Record<string, never>>, string>;
type SqliteScopedDb = ScopedDb<SQLJsDatabase<Record<string, never>>, string>;

type _PgHasSelectDistinctOn = Expect<
  PgScopedDb["selectDistinctOn"] extends (...args: never[]) => unknown ? true : false
>;
type _SqliteSelectDistinctOnAbsent = Expect<Equal<SqliteScopedDb["selectDistinctOn"], undefined>>;

const _assertDistDeclarations = async (pgDb: PgScopedDb, sqliteDb: SqliteScopedDb) => {
  const pgRule = scopeByColumn(pgProjects, pgProjects.workspaceId, { insertKey: "workspaceId" });
  const sqliteRule = scopeByColumn(sqliteProjects, sqliteProjects.workspaceId, {
    insertKey: "workspaceId",
  });
  void [pgRule, sqliteRule];

  const pgRows = await pgDb
    .insert(pgProjects)
    .values({ id: "p", workspaceId: "w", name: "Project" })
    .returning({ id: pgProjects.id });
  const _pgReturning: { id: string }[] = pgRows;

  const sqliteRows = await sqliteDb
    .insert(sqliteProjects)
    .values({ id: "p", workspaceId: "w", name: "Project" })
    .returning({ id: sqliteProjects.id });
  const _sqliteReturning: { id: string }[] = sqliteRows;

  // @ts-expect-error Scoped select builders from emitted declarations stay narrow.
  void pgDb.select().from(pgProjects).prepare;
  // @ts-expect-error SQLite scoped DB declarations do not expose a usable selectDistinctOn method.
  sqliteDb.selectDistinctOn([sqliteProjects.id], { id: sqliteProjects.id });
};
void _assertDistDeclarations;
