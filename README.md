# drizzle-scoped-db

Typed tenant scoping for Drizzle ORM query builders.

`drizzle-scoped-db` creates scoped Drizzle handles such as `tenantDb`, `workspaceDb`, or `organizationDb`. Scoped handles keep the tenant boundary visible in TypeScript, validate scoped inserts, and fail loudly when strict-mode queries omit the tenant predicate.

It is not database-enforced Row Level Security (RLS), though the two can be used together.

## Why use it

- Pass typed scoped DB handles instead of the raw DB.
- Declare scoping rules once per table.
- Strict mode by default: missing `where` or missing scope predicate throws.
- Inject scope predicates into supported selects, joins, mutations, and relational root queries.
- Validate scoped inserts before they reach the database.
- Catch missing predicates in human-written, generated, or agent-authored code.

## How this relates to RLS

RLS is enforced by the database. `drizzle-scoped-db` is enforced by the application path: tenant-scoped code receives a scoped Drizzle handle instead of the raw DB. It focuses on typed query builders, explicit scoped capabilities, and loud failures when predicates are missing.

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
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));

// Also injected automatically: eq(projects.workspaceId, workspaceId)
```

Conceptually, strict mode makes scoped reads look like this:

```sql
WHERE projects.id = projectId
  AND projects.tenant_id = tenantId -- caller wrote this; strict mode checks it
  AND projects.tenant_id = tenantId -- wrapper injects this again
```

Application code that should be tenant-scoped should receive the scoped DB handle, not the raw Drizzle instance. RLS and scoped handles are not mutually exclusive; use both when you want typed app boundaries plus database-level enforcement outside the query-builder path.

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
import { and, eq } from "drizzle-orm";
import { projects, tasks } from "./schema";

const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules: [
    scopeByColumn(projects, projects.workspaceId, { insertKey: "workspaceId" }),
    scopeByColumn(tasks, tasks.workspaceId, { insertKey: "workspaceId" }),
  ],
});

const project = await workspaceDb
  .select()
  .from(projects)
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
```

The wrapper still injects the workspace predicate again as defense in depth.

Joined tables with declared rules receive their own scope predicates too. For joins, the joined table predicate is added to the join condition so `leftJoin` keeps its outer-join behavior:

```ts
const rows = await workspaceDb
  .select()
  .from(projects)
  .leftJoin(tasks, eq(tasks.projectId, projects.id))
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));

// Also injected automatically:
// - eq(projects.workspaceId, workspaceId) in the WHERE clause
// - eq(tasks.workspaceId, workspaceId) in the JOIN condition
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
await workspaceDb
  .update(tasks)
  .set({ status: "done" })
  .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));

await workspaceDb
  .delete(tasks)
  .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
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
  where: (project, { and, eq }) =>
    and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)),
  with: {
    tasks: true,
  },
});
```

Tables without a matching rule pass through unchanged.

By default, relational `with` entries are root-only: `findFirst` / `findMany` are scoped, but nested relation rows rely on tenant-safe relationships, explicit relation filters, or database constraints.

Experimental POC: pass `relationalWithMode: "scope"` and add a relation map to scope nested `with` entries recursively.

```ts
const taskRule = scopeByColumn(tasks, tasks.workspaceId, {
  queryName: "tasks",
  insertKey: "workspaceId",
});

const projectRule = scopeByColumn(projects, projects.workspaceId, {
  queryName: "projects",
  insertKey: "workspaceId",
  relations: {
    tasks: taskRule,
  },
});

const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  relationalWithMode: "scope",
  rules: [projectRule, taskRule],
});

await workspaceDb.query.projects.findFirst({
  where: (project, { and, eq }) =>
    and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)),
  with: {
    tasks: true,
  },
});

// Also injected into the nested relation: eq(tasks.workspaceId, workspaceId)
```

In `"scope"` mode, every requested relation must be present in the parent rule's `relations` map. Use `relationalWithMode: "forbid"` to reject relational `with` entirely.

## Data model shape

This package works best when tenant ownership is represented in your schema:

- tenant/scope columns on tenant-owned tables
- scoped rules for protected tables
- indexes for scoped access paths, e.g. `(tenant_id, id)` and `(tenant_id, foreign_id)`
- globally unique IDs or constraints that reject invalid cross-tenant references

Write rules explicitly for small schemas, or generate them once from schema metadata in an app-specific facade.

Explicit rules:

```ts
const rules = [
  scopeByColumn(projects, projects.tenantId, { insertKey: "tenantId" }),
  scopeByColumn(tasks, tasks.tenantId, { insertKey: "tenantId" }),
  scopeByColumn(comments, comments.tenantId, { insertKey: "tenantId" }),
];
```

Generated rules:

```ts
const tenantScopedRules = Object.values(schema)
  .filter((table) => isDrizzleTable(table) && "tenantId" in table)
  .map((table) =>
    scopeByColumn(table, table.tenantId, {
      insertKey: "tenantId",
      columnName: "tenant_id",
    }),
  );
```

With either shape, the wrapper can scope root tables and joined tables with rules. Your schema still owns data consistency, such as preventing a task in one tenant from referencing another tenant's project.

## Strict mode

Strict mode is enabled by default and intended for most app code. Scoped selects, updates, deletes, and relational queries must include a `where` clause with the declared scope predicate.

This is intentionally not magic: callers write the tenant predicate, the wrapper verifies it, then injects it again. If generated code, agent-authored code, or a rushed refactor forgets the predicate, the query throws.

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules: [scopeByColumn(projects, projects.workspaceId)],
});

// Throws MissingScopedWhereError
await workspaceDb.select().from(projects);

// Throws MissingScopedPredicateError
await workspaceDb.select().from(projects).where(eq(projects.id, projectId));

// Allowed; the wrapper still injects its own scope predicate as defense in depth.
await workspaceDb
  .select()
  .from(projects)
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
```

Custom `defineScopedTable` rules need `hasScopeInWhere` for strict validation. Opt out with `strict: false` if you want pure predicate injection:

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  strict: false,
  rules: [scopeByColumn(projects, projects.workspaceId)],
});

await workspaceDb.select().from(projects).where(eq(projects.id, projectId));
// Executes with: and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))
```

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

`drizzle-scoped-db` protects supported Drizzle query-builder calls that go through the scoped wrapper. It is not a complete database isolation system and cannot protect code that bypasses the scoped capability.

The wrapper intentionally exposes the original unscoped DB as a loud escape hatch:

```ts
workspaceDb._unsafeUnscopedDb;
```

Use it for migrations, admin jobs, test setup, cross-tenant maintenance, or unsupported query shapes. Queries through this property are not scoped.

The wrapper scopes supported selects, joins, mutations, root relational queries, and validated inserts. The schema shape in [Data model shape](#data-model-shape) still matters: your data model needs ownership columns, indexes, and relationship invariants that match how your app scopes data.

Relational `with` is root-only by default. The experimental `relationalWithMode: "scope"` POC can recursively scope mapped relations; `relationalWithMode: "forbid"` rejects `with` configs when you prefer fail-closed behavior.

Not protected:

- raw SQL, `_unsafeUnscopedDb`, or helpers that close over the raw DB
- query builder methods not wrapped by this package
- tables or joined tables without rules
- nested relational `with` rows when using default `relationalWithMode: "root-only"`, unless relationships, filters, or constraints enforce tenant safety
- invalid cross-tenant rows that your database constraints allow
- deliberate bypasses of the scoped DB capability

RLS, database permissions, and other database-native controls can be layered with scoped handles when you need enforcement outside the typed application query-builder path.

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

- `select().from(table).where(...)`, including `.leftJoin(...)` / `.innerJoin(...)` tables with rules
- `selectDistinct().from(table).where(...)`, including `.leftJoin(...)` / `.innerJoin(...)` tables with rules
- `selectDistinctOn(...).from(table).where(...)` when supported by the driver, including `.leftJoin(...)` / `.innerJoin(...)` tables with rules
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
  strict?: boolean; // defaults to true
  relationalWithMode?: "root-only" | "scope" | "forbid"; // defaults to 'root-only'
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
  relations?: Record<string, ScopedTableRule<TScope> | string>;
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
  // Required when createScopedDb({ strict: true }) is enabled.
  hasScopeInWhere?: (condition: SQL | undefined) => boolean;
  relations?: Record<string, ScopedTableRule<TScope> | string>;
};
```

### `assertDrizzleCompatibility(condition, expectedColumnName)`

Optional startup assertion for projects that rely on `strict` mode or `containsColumnFilter`.

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
- `UnsupportedRelationalWithError`

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
