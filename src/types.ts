import type { and, Column, eq, or, SQL, Table, TableConfig } from "drizzle-orm";

/** Table type used by Drizzle's PostgreSQL query builders. */
export type ScopedTable = Table<TableConfig> & {
  $inferSelect?: Record<string, unknown>;
  $inferInsert?: Record<string, unknown>;
};

/** A callback that receives a Drizzle relational table proxy and operators, then returns a SQL predicate. */
export type RelationalWhereCallback<TTable> = (
  table: TTable,
  operators: {
    and: typeof and;
    eq: typeof eq;
    or: typeof or;
    [key: string]: unknown;
  },
) => SQL | undefined;

/** A relational query where clause, either as Drizzle SQL or as Drizzle's callback form. */
export type RelationalWhere<TTable> = RelationalWhereCallback<TTable> | SQL | undefined;

/** Drizzle 1.0 RQBv2 object-filter where shape. */
export type RelationalObjectWhere = Record<string, unknown>;

/** A table-specific scoping rule. */
export type ScopedTableRule<
  TScope,
  TTable extends ScopedTable = ScopedTable,
  TInsert = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> = {
  /** Drizzle table object that this rule protects. */
  table: TTable;
  /** Optional db.query property name for Drizzle relational query API support. */
  queryName?: string;
  /** Human-readable table name used in errors. Defaults to Drizzle's SQL table name. */
  tableName?: string;
  /** Predicate that is always injected into scoped select/update/delete/find queries. */
  where: (scopeValue: TScope) => SQL | undefined;
  /** Optional insert row validator. Return true only when the row belongs to scopeValue. */
  validateInsert?: (row: TInsert, scopeValue: TScope) => boolean;
  /** Optional update payload validator. Return true only when the updated fields are valid for scopeValue. */
  validateUpdate?: (payload: TUpdate, scopeValue: TScope) => boolean;
  /** Legacy conflict-target detector retained for compatibility; the scoped upsert path no longer consults it. */
  hasScopeInConflictTarget?: (target: unknown) => boolean;
  /**
   * Optional strict-mode validator for checking whether user-supplied where already includes scope.
   * Required when `strict` mode is enabled; rules without a detector fail strict validation.
   */
  hasScopeInWhere?: (condition: SQL | undefined) => boolean;
  /** Optional Drizzle 1.0 RQBv2 object-filter support for relational `db.query.*` wrappers. */
  relational?: {
    /** Object filter that is always injected into RQBv2 relational find queries. */
    where: (scopeValue: TScope) => RelationalObjectWhere | undefined;
    /** Strict-mode validator for checking whether a user RQBv2 object filter already includes scope. */
    hasScopeInWhere?: (condition: unknown) => boolean;
  };
};

/** Error customization hooks for scoped wrappers. */
export type ScopedDbErrors<TScope> = {
  missingWhere?: (tableName: string, scopeName: string, scopeValue: TScope) => Error;
  missingScope?: (tableName: string, scopeName: string, scopeValue: TScope) => Error;
  invalidInsert?: (
    tableName: string,
    row: Record<string, unknown>,
    scopeName: string,
    scopeValue: TScope,
  ) => Error;
  invalidUpdate?: (
    tableName: string,
    row: Record<string, unknown>,
    scopeName: string,
    scopeValue: TScope,
  ) => Error;
  invalidConflictTarget?: (tableName: string, scopeName: string, scopeValue: TScope) => Error;
};

/** Options for creating a scoped Drizzle wrapper. */
export type CreateScopedDbOptions<
  TScope,
  TExtensions extends Record<string, unknown> = {},
  TUnscopedDbPropertyName extends string = "_unsafeUnscopedDb",
  TScopeValuePropertyName extends string | undefined = undefined,
> = {
  /** Human-readable scope name, for example `organization`, `tenant`, or `workspace`. */
  scopeName: string;
  /** The current scope value that will be injected into protected queries. */
  scopeValue: TScope;
  /** Table-specific scoping rules. Tables without rules pass through unchanged. */
  rules: ScopedTableRule<TScope>[];
  /**
   * Strict mode requires callers to provide `.where(...)` and include the declared scope predicate.
   * Defaults to `true`; pass `false` to allow implicit scope-only queries.
   */
  strict?: boolean;
  /** Property name for the intentionally unsafe unscoped DB escape hatch. Defaults to `_unsafeUnscopedDb`. */
  unscopedDbPropertyName?: TUnscopedDbPropertyName;
  /** Optional property name that exposes the current scope value. */
  scopeValueProperty?: TScopeValuePropertyName;
  /** Optional custom JSON serialization hook. */
  toJSON?: (scopeValue: TScope, scopeName: string) => unknown;
  /** Optional extension methods/properties copied onto every scoped wrapper, including transactions. */
  extensions?: (scopeValue: TScope, scopeName: string) => TExtensions;
  /** Optional error factories. */
  errors?: ScopedDbErrors<TScope>;
};

/**
 * Type helper to infer selected values from a Drizzle selection object. Mirrors the shapes Drizzle
 * itself allows in a projection: plain columns, raw `sql<T>` fragments, aliased `sql<T>().as()`
 * fragments, and nested selection objects. Unknown leaf shapes fall back to `unknown` (not `never`)
 * so downstream spreads, `.map(...)`, and assignments stay usable.
 */
export type InferSelection<TSelection> = {
  [K in keyof TSelection]: TSelection[K] extends Column<infer Config>
    ? Config["data"]
    : TSelection[K] extends SQL<infer T>
      ? T
      : TSelection[K] extends SQL.Aliased<infer T>
        ? T
        : TSelection[K] extends Record<string, unknown>
          ? InferSelection<TSelection[K]>
          : unknown;
};

/** Query builder returned after `.where(...)` is called. */
export interface ScopedWhereBuilder<TResult> extends Promise<TResult> {
  limit(n: number): ScopedWhereBuilder<TResult>;
  offset(n: number): ScopedWhereBuilder<TResult>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
  orderBy(...columns: any[]): ScopedWhereBuilder<TResult>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
  groupBy(...columns: any[]): ScopedWhereBuilder<TResult>;
  having(condition: SQL | undefined): ScopedWhereBuilder<TResult>;
}

/** Query builder returned after selecting from a scoped table. */
export interface ScopedQueryBuilder<
  TTable extends ScopedTable,
  TResult = NonNullable<TTable["$inferSelect"]>[],
> {
  where(condition: SQL | undefined): ScopedWhereBuilder<TResult>;
  leftJoin<TJoinTable extends Table<TableConfig>>(
    table: TJoinTable,
    on: SQL | undefined,
  ): ScopedQueryBuilder<TTable, TResult>;
  innerJoin<TJoinTable extends Table<TableConfig>>(
    table: TJoinTable,
    on: SQL | undefined,
  ): ScopedQueryBuilder<TTable, TResult>;
  then<TResult1 = TResult, TResult2 = never>(
    onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

/** Select builder facade that scopes only tables with matching rules. */
export interface ScopedSelectBuilder<TSelection = undefined> {
  from<TTable extends ScopedTable>(
    table: TTable,
  ): ScopedQueryBuilder<
    TTable,
    TSelection extends undefined
      ? NonNullable<TTable["$inferSelect"]>[]
      : InferSelection<TSelection>[]
  >;
}

/**
 * Forwards a single raw-builder method—with its exact, per-dialect signature—onto a scoped
 * facade, but only when the underlying builder actually provides it. The tuple wrapping prevents
 * distribution over unions.
 */
export type ForwardMethod<TRaw, TName extends string> = [TRaw] extends [
  { [K in TName]: infer TMethod },
]
  ? { [K in TName]: TMethod }
  : {};

/**
 * Dialect-gated, table-precise `returning(...)`. Present only when the underlying builder exposes a
 * RETURNING clause (Postgres/SQLite, not MySQL). No-arg returning yields the table's full row type;
 * the column-projection overload mirrors Drizzle's selection inference. Row types come from `TTable`
 * rather than the raw builder, so they stay precise instead of degrading to `unknown`.
 */
export type ScopedReturning<TRaw, TTable> = [TRaw] extends [{ returning: unknown }]
  ? {
      returning(): Promise<
        NonNullable<TTable extends ScopedTable ? TTable["$inferSelect"] : never>[]
      >;
      returning<TSelection extends Record<string, unknown>>(
        columns: TSelection,
      ): Promise<InferSelection<TSelection>[]>;
    }
  : {};

/**
 * Terminal result of a scoped update/delete. Always awaitable, and—only when the underlying
 * dialect's builder exposes a RETURNING clause (Postgres/SQLite, not MySQL)—chainable with a
 * table-precise `.returning(...)`.
 */
export type ScopedMutationResult<TRaw = unknown, TTable = ScopedTable> = Promise<Awaited<TRaw>> &
  ScopedReturning<TRaw, TTable>;

/**
 * Terminal result of a scoped insert. Everything {@link ScopedMutationResult} offers (awaitable plus
 * a table-precise `.returning(...)` where the dialect supports it), and `$returningId()` on MySQL.
 *
 * PostgreSQL/SQLite conflict methods are exposed only when the dialect provides them. The runtime
 * wrapper validates scoped `onConflictDoUpdate(...)` calls before forwarding; MySQL-style
 * `onDuplicateKeyUpdate(...)` still requires `.$unsafeUnscoped()` because it does not name a conflict
 * target that the scoped facade can inspect.
 */
export type ScopedInsertResult<TRaw = unknown, TTable = ScopedTable> = ScopedMutationResult<
  TRaw,
  TTable
> &
  ForwardMethod<TRaw, "$returningId"> &
  ForwardChainMethod<TRaw, TTable, "onConflictDoNothing"> &
  ForwardChainMethod<TRaw, TTable, "onConflictDoUpdate"> & {
    /**
     * Return the raw dialect insert builder, already carrying this insert's scoped `.values(...)`
     * payload. Use it to chain conflict/upsert methods and audit their target/set/where clauses at
     * the call site.
     */
    $unsafeUnscoped(): UnscopedInsertBuilder<TRaw, TTable>;
  };

/**
 * Forwards a raw conflict/upsert method (`onConflictDoNothing` / `onConflictDoUpdate` /
 * `onDuplicateKeyUpdate`) with its exact per-dialect argument types, but retypes the return as a
 * {@link ScopedInsertResult} so a trailing `.returning(...)` stays table-precise instead of degrading
 * to the raw builder's widened row type. Sibling of {@link ForwardMethod}, which forwards a method
 * unchanged; this variant rewrites the return type. Contributes nothing for dialects lacking the method.
 */
export type ForwardChainMethod<TRaw, TTable, TName extends string> = [TRaw] extends [
  { [K in TName]: (...args: infer TArgs) => infer TReturn },
]
  ? { [K in TName]: (...args: TArgs) => ScopedInsertResult<TReturn, TTable> }
  : {};

/**
 * Surface returned by `.$unsafeUnscoped()`: the raw dialect insert builder, passed through unchanged
 * except that the conflict/upsert methods and `.returning(...)` are retyped table-precise. The raw
 * builder's own `.returning(...)` widens its row type to `Record<string, unknown>` once threaded
 * through the scoped wrapper, so column-accurate types are restored here from `TTable` (the same way
 * the scoped result itself stays precise).
 */
export type UnscopedInsertBuilder<TRaw, TTable> = Omit<
  TRaw,
  "returning" | "onConflictDoNothing" | "onConflictDoUpdate" | "onDuplicateKeyUpdate"
> &
  ScopedReturning<TRaw, TTable> &
  ForwardChainMethod<TRaw, TTable, "onConflictDoNothing"> &
  ForwardChainMethod<TRaw, TTable, "onConflictDoUpdate"> &
  ForwardChainMethod<TRaw, TTable, "onDuplicateKeyUpdate">;

/** Raw builder type a dialect returns from `db.insert(table)`, instantiated for `TTable`. */
export type RawInsertBuilder<TDb, TTable = ScopedTable> = TDb extends {
  insert: (table: TTable) => infer TInsert;
}
  ? TInsert
  : unknown;

/** Raw builder type a dialect returns from `db.update(table)`, instantiated for `TTable`. */
export type RawUpdateBuilder<TDb, TTable = ScopedTable> = TDb extends {
  update: (table: TTable) => infer TUpdate;
}
  ? TUpdate
  : unknown;

/** Raw builder type a dialect returns from `db.delete(table)`, instantiated for `TTable`. */
export type RawDeleteBuilder<TDb, TTable = ScopedTable> = TDb extends {
  delete: (table: TTable) => infer TDelete;
}
  ? TDelete
  : unknown;

type TableInsertValue<TTable> = TTable extends { $inferInsert: infer TInsert }
  ? { [K in keyof TInsert]: TInsert[K] | SQL }
  : Record<string, unknown>;

type TableUpdateValue<TTable> = Partial<TableInsertValue<TTable>>;

type RawInsertResultFromValues<TRawInsert> = [TRawInsert] extends [
  { values: (...args: never[]) => infer TResult },
]
  ? TResult
  : unknown;

/** Minimal insert builder facade exposed by scoped DB wrappers. */
export interface ScopedInsertBuilder<TRawInsert = unknown, TTable = ScopedTable> {
  values(
    value: TableInsertValue<TTable>,
  ): ScopedInsertResult<RawInsertResultFromValues<TRawInsert>, TTable>;
  values(
    values: TableInsertValue<TTable>[],
  ): ScopedInsertResult<RawInsertResultFromValues<TRawInsert>, TTable>;
}

type RawWhereResult<TRaw> = [TRaw] extends [
  { where: (condition: SQL | undefined) => infer TResult },
]
  ? TResult
  : [TRaw] extends [{ where: (condition: SQL) => infer TResult }]
    ? TResult
    : unknown;

type RawUpdateSetResult<TRawUpdate> = [TRawUpdate] extends [
  { set: (...args: never[]) => infer TSet },
]
  ? TSet
  : unknown;

/** Minimal update builder facade exposed by scoped DB wrappers. */
export interface ScopedUpdateBuilder<TRawUpdate = unknown, TTable = ScopedTable> {
  set(
    values: TableUpdateValue<TTable>,
  ): ScopedUpdateWhereBuilder<RawUpdateSetResult<TRawUpdate>, TTable>;
}

/** Builder facade returned after `.set(...)` is called. */
export interface ScopedUpdateWhereBuilder<TRawSet = unknown, TTable = ScopedTable> {
  where(condition: SQL | undefined): ScopedMutationResult<RawWhereResult<TRawSet>, TTable>;
}

/** Minimal delete builder facade exposed by scoped DB wrappers. */
export interface ScopedDeleteBuilder<TRawDelete = unknown, TTable = ScopedTable> {
  where(condition: SQL | undefined): ScopedMutationResult<RawWhereResult<TRawDelete>, TTable>;
}

/** Surface exposed by scoped Drizzle database wrappers. */
export type ScopedDb<
  TDb extends object,
  TScope,
  TExtensions extends Record<string, unknown> = {},
  TUnscopedDbPropertyName extends string = "_unsafeUnscopedDb",
  TScopeValuePropertyName extends string | undefined = undefined,
> = {
  /** Select from a scoped table. */
  select<TSelection extends Record<string, unknown> | undefined = undefined>(
    columns?: TSelection,
  ): ScopedSelectBuilder<TSelection>;
  /** Select distinct from a scoped table. */
  selectDistinct<TSelection extends Record<string, unknown> | undefined = undefined>(
    columns?: TSelection,
  ): ScopedSelectBuilder<TSelection>;
  /** Select distinct on columns from a scoped table, when the underlying DB exposes it. */
  selectDistinctOn: TDb extends { selectDistinctOn: infer TSelectDistinctOn }
    ? TSelectDistinctOn extends (...args: never[]) => unknown
      ? <TSelection extends Record<string, unknown> | undefined = undefined>(
          onColumns: unknown[],
          columns?: TSelection,
        ) => ScopedSelectBuilder<TSelection>
      : undefined
    : undefined;
  /** Insert into a scoped table. */
  insert<TTable extends ScopedTable>(
    table: TTable,
  ): ScopedInsertBuilder<RawInsertBuilder<TDb, TTable>, TTable>;
  /** Update a scoped table. */
  update<TTable extends ScopedTable>(
    table: TTable,
  ): ScopedUpdateBuilder<RawUpdateBuilder<TDb, TTable>, TTable>;
  /** Delete from a scoped table. */
  delete<TTable extends ScopedTable>(
    table: TTable,
  ): ScopedDeleteBuilder<RawDeleteBuilder<TDb, TTable>, TTable>;
  /** Start a scoped transaction. */
  transaction<T>(
    callback: (
      tx: ScopedDb<TDb, TScope, TExtensions, TUnscopedDbPropertyName, TScopeValuePropertyName>,
    ) => Promise<T>,
  ): Promise<T>;
  /** The raw relational query API, with scoped wrappers on protected tables. */
  query: TDb extends { query: infer TQuery } ? TQuery : undefined;
  /** Optional custom JSON serialization hook. */
  toJSON?: () => unknown;
} & TExtensions &
  Record<TUnscopedDbPropertyName, TDb> &
  (TScopeValuePropertyName extends string ? Record<TScopeValuePropertyName, TScope> : {});

/** Options for the column-based scoping shortcut. */
export type ScopeByColumnOptions<TScope> = {
  /** Optional db.query property name for relational query API support. */
  queryName?: string;
  /** Human-readable table name used in errors. */
  tableName?: string;
  /** Insert row property that should equal the current scope value. */
  insertKey?: string;
  /** Update payload property that should equal the current scope value if present. Defaults to `insertKey`. */
  updateKey?: string;
  /** SQL column name used by strict validation. Defaults to the Drizzle column name. */
  columnName?: string;
  /** Custom equality function for insert validation. Defaults to Object.is. */
  equals?: (rowValue: unknown, scopeValue: TScope) => boolean;
};
