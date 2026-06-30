# API reference

## Imports

```ts
import {
  assertDrizzleCompatibility,
  containsColumnFilter,
  createScopedDb,
  defineScopedTable,
  scopeByColumn,
} from "@modemdev/drizzle-scoped-db";
```

## `createScopedDb(db, options)`

Wrap a Drizzle database handle with scoped query-builder facades.

```ts
type CreateScopedDbOptions<TScope> = {
  scopeName: string;
  scopeValue: TScope;
  rules: ScopedTableRule<TScope>[];
  strict?: boolean; // defaults to true
  unscopedDbPropertyName?: string; // defaults to "_unsafeUnscopedDb"
  scopeValueProperty?: string;
  toJSON?: (scopeValue: TScope, scopeName: string) => unknown;
  extensions?: (scopeValue: TScope, scopeName: string) => Record<string, unknown>;
  errors?: ScopedDbErrors<TScope>;
};
```

Example:

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules: [scopeByColumn(projects, projects.workspaceId, { insertKey: "workspaceId" })],
});
```

## `scopeByColumn(table, column, options)`

Create a rule for the common case where one table column stores the scope value.

```ts
type ScopeByColumnOptions<TScope> = {
  queryName?: string;
  tableName?: string;
  insertKey?: string;
  updateKey?: string; // defaults to insertKey
  columnName?: string;
  equals?: (rowValue: unknown, scopeValue: TScope) => boolean;
};
```

Options:

- `queryName`: property name under `db.query` for relational query wrapping.
- `tableName`: human-readable name used in errors.
- `insertKey`: row key checked during `.insert(...).values(...)`.
- `updateKey`: payload key checked during `.update(...).set(...)` and scoped upserts. Defaults to `insertKey`.
- `columnName`: explicit database column name. Useful when a Drizzle column object does not expose a string `.name`.
- `equals`: custom equality function for comparing payload values to `scopeValue`.

## `defineScopedTable(table, rule)`

Create a custom rule for composite scopes or predicates that cannot be represented by one equality column.

```ts
type ScopedTableRule<
  TScope,
  TInsert = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
> = {
  table: Table;
  queryName?: string;
  tableName?: string;
  where: (scopeValue: TScope) => SQL | undefined;
  validateInsert?: (row: TInsert, scopeValue: TScope) => boolean;
  validateUpdate?: (payload: TUpdate, scopeValue: TScope) => boolean;
  hasScopeInConflictTarget?: (target: unknown) => boolean;
  hasScopeInWhere?: (condition: SQL | undefined) => boolean;
};
```

Notes:

- `where` provides the predicate the wrapper injects.
- `validateInsert` gates scoped inserts.
- `validateUpdate` gates scoped updates and scoped conflict updates.
- `hasScopeInWhere` is required for custom rules when `strict: true` should validate caller-provided predicates.
- `hasScopeInConflictTarget` is retained for compatibility; scoped PostgreSQL/SQLite upserts no longer require conflict targets to include the scope column.

## `containsColumnFilter(condition, expectedColumnName, expectedTable?)`

Return whether a Drizzle `SQL` predicate contains a comparison for the expected column, optionally scoped to a specific table object.

This is primarily useful for custom strict validation helpers and compatibility checks.

```ts
containsColumnFilter(eq(projects.workspaceId, workspaceId), "workspace_id", projects);
```

## `assertDrizzleCompatibility(condition, expectedColumnName, expectedTable?)`

Fail fast if a Drizzle upgrade changes SQL internals enough that strict validation cannot inspect predicates safely.

```ts
assertDrizzleCompatibility(eq(projects.workspaceId, "compat-check"), "workspace_id", projects);
```

Pass the table when using table-aware validation so the assertion verifies column chunks expose table identity.

## Errors

Default scoped validation errors:

- `MissingScopedWhereError`
- `MissingScopedPredicateError`
- `InvalidScopedInsertError`
- `InvalidScopedUpdateError`
- `InvalidScopedConflictTargetError`

Customize errors through `createScopedDb({ errors })`:

```ts
const scopedDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules,
  errors: {
    missingWhere: (tableName, scopeName, scopeValue) =>
      new Error(`${tableName} must include ${scopeName}=${scopeValue}`),
  },
});
```

## Wrapped APIs

Currently wrapped:

- `select().from(table).where(...)`, including `.leftJoin(...)` / `.innerJoin(...)` tables with rules
- `selectDistinct().from(table).where(...)`, including `.leftJoin(...)` / `.innerJoin(...)` tables with rules
- `selectDistinctOn(...).from(table).where(...)` when supported by the driver, including `.leftJoin(...)` / `.innerJoin(...)` tables with rules
- `insert(table).values(...)`, plus `.returning(...)`, `.$returningId()`, `.onConflictDoNothing(...)`, safe `.onConflictDoUpdate(...)` when supported, and `.$unsafeUnscoped()` for raw continuation
- `update(table).set(...).where(...)`
- `delete(table).where(...)`
- `query.<queryName>.findFirst(...)`
- `query.<queryName>.findMany(...)`
- `transaction(...)`, with a scoped transaction DB passed to the callback

Tables without rules and unwrapped APIs pass through to the underlying Drizzle instance.

## Type exports

The package exports the main helper types used by the public API:

- `CreateScopedDbOptions`
- `InferSelection`
- `RelationalWhere`
- `RelationalWhereCallback`
- `ScopedDb`
- `ScopedDbErrors`
- `ScopedDeleteBuilder`
- `ScopedInsertBuilder`
- `ScopedInsertResult`
- `ScopedMutationResult`
- `ScopedQueryBuilder`
- `ScopedSelectBuilder`
- `ScopedTable`
- `ScopedTableRule`
- `ScopedUpdateBuilder`
- `ScopedWhereBuilder`
- `ScopeByColumnOptions`
