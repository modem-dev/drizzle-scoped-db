# drizzle-scoped-db

Typed tenant scoping for Drizzle ORM query builders.

`drizzle-scoped-db` lets you create scoped Drizzle database handles such as `tenantDb`, `workspaceDb`, or `organizationDb`. Queries made through that handle automatically receive the declared scope predicates, and scoped inserts are validated before they reach the database.

Think of it as a typed, application-layer alternative to Row Level Security (RLS): instead of relying on database session state and policies, you pass a scoped DB capability through your TypeScript code.

## Why use it

- Create a scoped DB handle once per request, job, or tenant context.
- Declare scoping rules once per table.
- Automatically inject scope predicates into `select`, `update`, `delete`, and relational `findFirst` / `findMany` queries.
- Validate scoped inserts before they reach the database.
- Model any scope shape: one column, different columns per table, composite predicates, or custom validators.
- Keep the tenant boundary visible in TypeScript by passing scoped DB handles instead of the raw DB.
- Work across Drizzle drivers that expose the standard query-builder APIs.

## RLS vs scoped DB handles

Database-native RLS is a good fit when you want the database to enforce tenant isolation for every SQL statement, including arbitrary raw SQL. It also comes with operational constraints: database support, policy authoring, session variables, connection-pool behavior, migrations, and test setup.

`drizzle-scoped-db` takes a different approach. It makes tenant isolation an explicit application capability:

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules,
});

const project = await workspaceDb
  .select({
    id: projects.id,
    name: projects.name,
  })
  .from(projects)
  .where(eq(projects.id, projectId));

// Injected automatically: and(eq(projects.workspaceId, workspaceId))
```

That gives you a portable, typed boundary that is easy to test and works in request handlers, background jobs, workers, scripts, and apps that do not use Postgres.

You can use this instead of RLS, or combine it with RLS for defense in depth. The important rule is simple: application code that should be tenant-scoped should receive the scoped DB handle, not the original unscoped Drizzle instance.

## Install

```bash
npm install @modemdev/drizzle-scoped-db drizzle-orm
```

```bash
pnpm add @modemdev/drizzle-scoped-db drizzle-orm
```

Drizzle is a peer dependency.

## Quick start

```ts
import { createScopedDb, scopeByColumn } from "@modemdev/drizzle-scoped-db";
import { eq } from "drizzle-orm";
import { projects, tasks } from "./schema";

const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules: [
    scopeByColumn(projects, projects.workspaceId, { insertKey: "workspaceId" }),
    scopeByColumn(tasks, tasks.workspaceId, { insertKey: "workspaceId" }),
  ],
});

const project = await workspaceDb.select().from(projects).where(eq(projects.id, projectId));
```

The executed query is scoped as if you wrote:

```ts
where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
```

## Insert validation

When `insertKey` is provided, inserted rows must match the current scope value.

```ts
await workspaceDb.insert(projects).values({
  id: projectId,
  workspaceId,
  name: "Roadmap",
});

// Throws InvalidScopedInsertError
await workspaceDb.insert(projects).values({
  id: projectId,
  workspaceId: "another-workspace",
  name: "Wrong workspace",
});
```

Batch inserts are validated row by row.

## Update and delete

Scoped predicates are injected into mutations too.

```ts
await workspaceDb.update(tasks).set({ status: "done" }).where(eq(tasks.id, taskId));

await workspaceDb.delete(tasks).where(eq(tasks.id, taskId));
```

## Relational query API

Declare `queryName` to scope `db.query.<name>.findFirst` and `findMany`.

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules: [
    scopeByColumn(projects, projects.workspaceId, {
      queryName: "projects",
      insertKey: "workspaceId",
    }),
  ],
});

const project = await workspaceDb.query.projects.findFirst({
  where: (project, { eq }) => eq(project.id, projectId),
  with: {
    tasks: true,
  },
});
```

Tables without a matching rule pass through unchanged.

## Require a caller `where` clause

By default, a scoped query may execute without a caller-provided `where`; the wrapper injects only the scope predicate.

Enable `requireWhere` if every scoped select/update/delete should include an explicit caller condition:

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  requireWhere: true,
  rules: [scopeByColumn(projects, projects.workspaceId)],
});

// Throws MissingScopedWhereError
await workspaceDb.select().from(projects);
```

## Strict scope-in-where mode

The default safety mechanism is predicate injection: the wrapper adds the declared scope predicate even if the caller forgets it.

Enable `requireScopeInWhere` when you also want to enforce codebase discipline by requiring callers to include the scope predicate in their own `where` clauses.

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  requireScopeInWhere: true,
  rules: [scopeByColumn(projects, projects.workspaceId)],
});

// Throws MissingScopedPredicateError
await workspaceDb.select().from(projects).where(eq(projects.id, projectId));

// Allowed; the wrapper still injects its own scope predicate as defense in depth.
await workspaceDb
  .select()
  .from(projects)
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
```

This mode inspects Drizzle SQL chunks to detect column references. Custom `defineScopedTable` rules must provide `hasScopeInWhere`; otherwise strict validation fails because the wrapper has no safe way to prove the caller supplied the scope predicate.

## Custom scope rules

Use `defineScopedTable` for composite scopes or predicates that are not a single equality column.

```ts
import { createScopedDb, defineScopedTable } from "@modemdev/drizzle-scoped-db";
import { and, eq } from "drizzle-orm";

const scopedDb = createScopedDb(db, {
  scopeName: "workspace-region",
  scopeValue: { workspaceId, regionId },
  rules: [
    defineScopedTable(records, {
      where: (scope) =>
        and(eq(records.workspaceId, scope.workspaceId), eq(records.regionId, scope.regionId)),
      validateInsert: (row, scope) =>
        row.workspaceId === scope.workspaceId && row.regionId === scope.regionId,
    }),
  ],
});
```

## Security model

`drizzle-scoped-db` protects queries that go through the scoped wrapper. It is designed to make the safe path the normal path: pass scoped DB handles to tenant-scoped application code.

The wrapper intentionally exposes the original unscoped DB as a loud escape hatch:

```ts
workspaceDb._unsafeUnscopedDb;
```

Use it for migrations, admin jobs, test setup, cross-tenant maintenance, or unsupported query shapes. Queries through this property are not scoped.

Not protected:

- raw SQL executed through the original DB
- queries run through `_unsafeUnscopedDb`
- custom helpers that close over the original unscoped DB
- query builder methods not wrapped by this package
- code that deliberately bypasses the scoped DB capability

If your threat model includes arbitrary raw SQL execution, compromised application code, or direct database access outside your app, use database-native controls as well.

## Dialect support

The package uses Drizzle core `Table`, `Column`, and `SQL` types, so rules are not tied to `pg-core`.

Expected support:

- PostgreSQL
- SQLite
- MySQL
- SingleStore
- any Drizzle driver with the standard `select`, `insert`, `update`, `delete`, and optional `query` APIs

`selectDistinctOn` is exposed only when the wrapped Drizzle instance provides it, which is primarily a PostgreSQL feature.

## Wrapped APIs

Currently wrapped:

- `select().from(table).where(...)`
- `selectDistinct().from(table).where(...)`
- `selectDistinctOn(...).from(table).where(...)` when supported by the driver
- `insert(table).values(...)`
- `update(table).set(...).where(...)`
- `delete(table).where(...)`
- `query.<queryName>.findFirst(...)`
- `query.<queryName>.findMany(...)`
- `transaction(...)`, with a scoped transaction DB passed to the callback

Tables without rules and unwrapped APIs pass through to the underlying Drizzle instance.

## API

### `createScopedDb(db, options)`

```ts
type CreateScopedDbOptions<TScope> = {
  scopeName: string;
  scopeValue: TScope;
  rules: ScopedTableRule<TScope>[];
  requireWhere?: boolean;
  requireScopeInWhere?: boolean;
  unscopedDbPropertyName?: string; // defaults to '_unsafeUnscopedDb'
  scopeValueProperty?: string;
  toJSON?: (scopeValue: TScope, scopeName: string) => unknown;
  extensions?: (scopeValue: TScope, scopeName: string) => Record<string, unknown>;
  errors?: ScopedDbErrors<TScope>;
};
```

### `scopeByColumn(table, column, options)`

```ts
type ScopeByColumnOptions<TScope> = {
  queryName?: string;
  tableName?: string;
  insertKey?: string;
  columnName?: string;
  equals?: (rowValue: unknown, scopeValue: TScope) => boolean;
};
```

### `defineScopedTable(table, rule)`

```ts
type ScopedTableRule<TScope, TInsert = Record<string, unknown>> = {
  table: Table;
  queryName?: string;
  tableName?: string;
  where: (scopeValue: TScope) => SQL | undefined;
  validateInsert?: (row: TInsert, scopeValue: TScope) => boolean;
  // Required when createScopedDb({ requireScopeInWhere: true }) is enabled.
  hasScopeInWhere?: (condition: SQL | undefined) => boolean;
};
```

### `assertDrizzleCompatibility(condition, expectedColumnName)`

Optional startup assertion for projects that rely on `requireScopeInWhere` or `containsColumnFilter`.

```ts
import { assertDrizzleCompatibility } from "@modemdev/drizzle-scoped-db";
import { eq } from "drizzle-orm";

assertDrizzleCompatibility(eq(projects.workspaceId, "compat-check"), "workspace_id");
```

If a Drizzle upgrade changes the internal SQL chunk shape, this fails fast instead of letting strict validation silently return `false`.

## Errors

- `MissingScopedWhereError`
- `MissingScopedPredicateError`
- `InvalidScopedInsertError`

You can replace these with custom error factories in `createScopedDb({ errors })`.

## Development

```bash
pnpm test
pnpm coverage
```

The package has 100% statement, branch, function, and line coverage.

## Sponsor

Sponsored by [Modem](https://modem.dev?utm_source=github&utm_medium=oss&utm_campaign=oss_drizzle_scoped_db&utm_content=readme_footer).

<a href="https://modem.dev?utm_source=github&utm_medium=oss&utm_campaign=oss_drizzle_scoped_db&utm_content=readme_footer">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://modem.dev/images/logo/svg/modem-combined-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://modem.dev/images/logo/svg/modem-combined-black.svg">
    <img src="https://modem.dev/images/logo/svg/modem-combined-black.svg" alt="Modem" width="220">
  </picture>
</a>

## License

MIT.
