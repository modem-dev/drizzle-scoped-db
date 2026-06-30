import { and, eq, or, type SQL } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";

export { aliasedTable, and, eq, or } from "drizzle-orm";
export type { Column, SQL } from "drizzle-orm";
export {
  assertDrizzleCompatibility,
  containsColumnFilter,
  createScopedDb,
  defineScopedTable,
  InvalidScopedConflictTargetError,
  InvalidScopedInsertError,
  InvalidScopedUpdateError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  scopeByColumn,
  type ScopedDb,
} from "../index";

export const projectsTbl = pgTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  regionId: text("region_id"),
  name: text("name").notNull(),
});

export const tasksTbl = pgTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskWorkspaceId: text("task_workspace_id").notNull(),
  title: text("title").notNull(),
});

export const usersTbl = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
});

export const projectsAuditTbl = pgTable("projects_audit", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
});

export type FakeDbState = {
  selectCondition?: SQL;
  joinConditions?: SQL[];
  insertValues?: unknown;
  conflictConfig?: unknown;
  conflictDidNothing?: boolean;
  groupByColumns?: unknown[];
  havingCondition?: SQL;
  updateCondition?: SQL;
  deleteCondition?: SQL;
  relationalCondition?: SQL;
  transactionRawDb?: FakeDb;
};

type RelationalProjectWhere =
  | SQL
  | ((table: typeof projectsTbl, operators: typeof relationalOperators) => SQL | undefined);

type FakeWhereResult = {
  condition: SQL | undefined;
  where(condition: SQL | undefined): FakeWhereResult;
  limit(n?: number): FakeWhereResult;
  offset(n?: number): FakeWhereResult;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
  orderBy(...columns: any[]): FakeWhereResult;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
  groupBy(...columns: any[]): FakeWhereResult;
  having(condition: SQL | undefined): FakeWhereResult;
};

type FakeFromBuilder = {
  where(condition: SQL | undefined): FakeWhereResult;
  leftJoin(table: unknown, on: SQL | undefined): FakeFromBuilder;
  innerJoin(table: unknown, on: SQL | undefined): FakeFromBuilder;
  prepare(): unknown;
  as(alias: string): unknown;
};

type FakeSelectBuilder = {
  from(table: unknown): FakeFromBuilder;
};

// Postgres/SQLite-shaped insert result: RETURNING plus chainable conflict resolution.
type FakeInsertResult = {
  values: unknown;
  returning(): FakeInsertResult;
  $dynamic(): FakeInsertResult;
  onConflictDoNothing(): FakeInsertResult;
  onConflictDoUpdate(config: unknown): FakeInsertResult;
  onDuplicateKeyUpdate(config: unknown): FakeInsertResult;
};

type FakeMutationResult = {
  condition: SQL | undefined;
  values?: Record<string, unknown>;
  where(condition: SQL | undefined): FakeMutationResult;
  returning(): FakeMutationResult;
  $dynamic(): FakeMutationResult;
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};

export type FakeDb = {
  query: {
    projects: {
      findFirst(config?: {
        where?: RelationalProjectWhere;
      }): Promise<{ condition: SQL | undefined }>;
      findMany(config?: {
        where?: RelationalProjectWhere;
      }): Promise<{ condition: SQL | undefined }[]>;
    };
    users: {
      findMany(config?: { limit?: number }): Promise<{ config: { limit?: number } | undefined }[]>;
    };
    metadata: string;
    incomplete: {
      findFirst(): Promise<undefined>;
    };
  };
  select(columns?: Record<string, unknown>): FakeSelectBuilder;
  selectDistinct(columns?: Record<string, unknown>): FakeSelectBuilder;
  selectDistinctOn(onColumns: unknown[], columns?: Record<string, unknown>): FakeSelectBuilder;
  insert(table: unknown): {
    values(values: unknown): FakeInsertResult;
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: SQL | undefined): FakeMutationResult;
    };
  };
  delete(table: unknown): {
    where(condition: SQL | undefined): FakeMutationResult;
  };
  transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T>;
  execute(): undefined;
  _state: FakeDbState;
};

/** Creates a minimal Drizzle-like DB that records the predicates passed into query builders. */
export function createFakeDb(state: FakeDbState = {}): FakeDb {
  const db = {
    query: {
      projects: {
        async findFirst(config?: { where?: RelationalProjectWhere }) {
          state.relationalCondition = resolveRelationalWhere(config?.where);
          return { condition: state.relationalCondition };
        },
        async findMany(config?: { where?: RelationalProjectWhere }) {
          state.relationalCondition = resolveRelationalWhere(config?.where);
          return [{ condition: state.relationalCondition }];
        },
      },
      users: {
        async findMany(config?: { limit?: number }) {
          return [{ config }];
        },
      },
      metadata: "unwrapped metadata",
      incomplete: {
        async findFirst() {
          return undefined;
        },
      },
    },
    select(_columns?: Record<string, unknown>) {
      return createSelectBuilder(state);
    },
    selectDistinct(_columns?: Record<string, unknown>) {
      return createSelectBuilder(state);
    },
    selectDistinctOn(_onColumns: unknown[], _columns?: Record<string, unknown>) {
      return createSelectBuilder(this._state);
    },
    insert(_table: unknown) {
      return {
        values(values: unknown) {
          state.insertValues = values;
          const result: FakeInsertResult = {
            values,
            returning() {
              return result;
            },
            $dynamic() {
              return result;
            },
            onConflictDoNothing() {
              state.conflictDidNothing = true;
              return result;
            },
            onConflictDoUpdate(config: unknown) {
              state.conflictConfig = config;
              return result;
            },
            onDuplicateKeyUpdate(config: unknown) {
              state.conflictConfig = config;
              return result;
            },
          };
          return result;
        },
      };
    },
    update(_table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: SQL | undefined) {
              state.updateCondition = condition;
              return createFakeMutationResult(
                condition,
                (next) => {
                  state.updateCondition = next;
                },
                values,
              );
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        where(condition: SQL | undefined) {
          state.deleteCondition = condition;
          return createFakeMutationResult(condition, (next) => {
            state.deleteCondition = next;
          });
        },
      };
    },
    async transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> {
      const tx = createFakeDb(state);
      state.transactionRawDb = tx;
      return callback(tx);
    },
    execute() {
      return undefined;
    },
    _state: state,
  };

  return db;
}

function createFakeMutationResult(
  condition: SQL | undefined,
  updateCondition: (condition: SQL | undefined) => void,
  values?: Record<string, unknown>,
): FakeMutationResult {
  const result: FakeMutationResult = {
    condition,
    values,
    where(nextCondition: SQL | undefined) {
      result.condition = nextCondition;
      updateCondition(nextCondition);
      return result;
    },
    returning() {
      return result;
    },
    $dynamic() {
      return result;
    },
    // oxlint-disable-next-line unicorn/no-thenable -- Drizzle mutation builders are thenable.
    then(onfulfilled, onrejected) {
      const awaited = {
        condition: result.condition,
        values,
        where: result.where,
        returning: result.returning,
        $dynamic: result.$dynamic,
      };
      return Promise.resolve(awaited).then(onfulfilled, onrejected);
    },
  };
  return result;
}

const relationalOperators = { and, eq, or };

/** Resolve the where shape that Drizzle relational queries accept. */
function resolveRelationalWhere(
  where:
    | SQL
    | ((table: typeof projectsTbl, operators: typeof relationalOperators) => SQL | undefined)
    | undefined,
): SQL | undefined {
  return typeof where === "function" ? where(projectsTbl, relationalOperators) : where;
}

/** Creates a minimal select builder with join and where methods. */
function createSelectBuilder(state: FakeDbState): FakeSelectBuilder {
  return {
    from(_table: unknown) {
      return createFromBuilder(state);
    },
  };
}

/** Creates a minimal from builder that records the final where predicate. */
function createFromBuilder(state: FakeDbState): FakeFromBuilder {
  const builder = {
    where(condition: SQL | undefined): FakeWhereResult {
      state.selectCondition = condition;
      const result: FakeWhereResult = {
        condition,
        // Drizzle's where() overwrites config.where (does not AND).
        where(condition2: SQL | undefined): FakeWhereResult {
          state.selectCondition = condition2;
          return result;
        },
        limit(_n?: number): FakeWhereResult {
          return result;
        },
        offset(_n?: number): FakeWhereResult {
          return result;
        },
        // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
        orderBy(..._columns: any[]): FakeWhereResult {
          return result;
        },
        // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
        groupBy(...columns: any[]): FakeWhereResult {
          state.groupByColumns = columns;
          return result;
        },
        having(condition: SQL | undefined): FakeWhereResult {
          state.havingCondition = condition;
          return result;
        },
      };
      return result;
    },
    leftJoin(_table: unknown, on: SQL): FakeFromBuilder {
      state.joinConditions = [...(state.joinConditions ?? []), on];
      return builder;
    },
    innerJoin(_table: unknown, on: SQL): FakeFromBuilder {
      state.joinConditions = [...(state.joinConditions ?? []), on];
      return builder;
    },
    prepare() {
      return undefined;
    },
    as(_alias: string) {
      return undefined;
    },
  };

  return builder;
}
