# drizzle-scoped-db

[![npm version](https://img.shields.io/npm/v/@modemdev/drizzle-scoped-db.svg)](https://www.npmjs.com/package/@modemdev/drizzle-scoped-db)
[![types](https://img.shields.io/npm/types/@modemdev/drizzle-scoped-db.svg)](https://www.npmjs.com/package/@modemdev/drizzle-scoped-db)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)](#development)
[![license](https://img.shields.io/npm/l/@modemdev/drizzle-scoped-db.svg)](./LICENSE)

**One forgotten `WHERE` clause and a query returns rows it should never see. `drizzle-scoped-db` guards against that.**

<p align="center">
  <img src="./assets/before-after.png" width="820" alt="With a plain Drizzle handle a forgotten org filter silently returns every org's rows; with a drizzle-scoped-db handle the same query throws MissingScopedWhereError, caught before it ships." />
</p>

It wraps a Drizzle ORM handle in a typed, scoped one (`orgDb`, `tenantDb`, `workspaceDb`). The guardrail fits any predicate a query must never forget: tenant, org, user, region, soft-delete. Scope predicates are injected into your queries automatically, and in strict mode a scoped query that forgets its predicate throws at the call site, before it reaches the database.

```ts
// Throws MissingScopedWhereError instead of returning every workspace's projects
await workspaceDb.select().from(projects);

// Allowed: scoped predicate is present (and re-injected as defense in depth)
await workspaceDb.select().from(projects).where(eq(projects.workspaceId, workspaceId));
```

### TL;DR

- 🛡️ **Strict by default.** A missing `where` or scope predicate throws instead of leaking rows.
- 🤖 **Catches the mistakes humans, codegen, and AI agents make.** The forgotten scope filter surfaces in review and at runtime, not in an incident.
- 🧩 **Dialect-generic.** Built on Drizzle core types (Postgres, SQLite, MySQL, SingleStore), no DB lock-in. Layers with RLS rather than replacing it.

## Where this fits

drizzle-scoped-db is an application-layer guardrail in the query builder. It isn't database-enforced isolation, and it's built to sit alongside RLS, not compete with it.

|                       | Enforcement layer   | Isolation model                    | DB lock-in             | Catches app-code mistakes |
| --------------------- | ------------------- | ---------------------------------- | ---------------------- | ------------------------- |
| **drizzle-scoped-db** | App (query builder) | Shared tables + injected predicate | None (dialect-generic) | ✅ typed + loud failures  |
| Drizzle native RLS    | Database            | Shared tables + row policies       | Postgres-only          | ❌ enforced below the app |
| drizzle-multitenant   | App (middleware)    | Schema-per-tenant                  | Postgres-only          | n/a (different model)     |
| pgvpd                 | Proxy / wire        | RLS via protocol proxy             | Postgres-only          | ❌                        |
| Nile                  | DB vendor           | Virtual tenant DBs                 | Nile-specific          | ❌                        |

RLS gives you a boundary the application can't bypass, but it lives in the database: per-row policy evaluation, connection-pooling friction, silent failures that are hard to debug, and Postgres only. PlanetScale [covers the tradeoffs](https://planetscale.com/blog/rls-sounds-great-until-it-isnt) in detail. drizzle-scoped-db keeps the scope boundary in application code instead, where it's visible in TypeScript, type-checked, and loud: a forgotten predicate throws instead of returning the wrong rows. If you want a database-level backstop too, layer RLS underneath. See [How this relates to RLS](#how-this-relates-to-rls).

## Why use it

- Pass typed scoped DB handles instead of the raw DB.
- Declare scoping rules once per table.
- Strict mode by default: missing `where` or missing scope predicate throws.
- Inject scope predicates into supported selects, joins, mutations, and relational root queries.
- Validate scoped inserts before they reach the database.
- Catch missing predicates in human-written, generated, or agent-authored code.

## Use cases

`drizzle-scoped-db` is a guardrail for any predicate a query must never forget. The scope is whatever you express as a Drizzle `where`:

- **Tenant or org isolation.** Keep `tenant_id = currentTenant` on every query so one customer never sees another's rows.
- **Per-user data.** Force `user_id = currentUser` on private rows.
- **Region or data residency.** Keep `region = 'eu'` on every query.
- **Soft deletes.** Always exclude deleted rows with `isNull(table.deletedAt)` via [`defineScopedTable`](#custom-scope-rules).
- **Visibility.** A read handle that injects `published = true`, so public endpoints never surface drafts.
- **Row-level ACLs.** A composite predicate such as `owner_id = me OR shared_with @> me`.

These share the same boundaries: the guardrail covers tables with rules, on the wrapped handle, in application code, not as a database-enforced boundary. See [Security model](#security-model).

## How this relates to RLS

RLS is enforced by the database. `drizzle-scoped-db` is enforced by the application path: scoped code receives a scoped Drizzle handle instead of the raw DB. It focuses on typed query builders, explicit scoped capabilities, and loud failures when predicates are missing.

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
  AND projects.workspace_id = workspaceId -- caller wrote this; strict mode checks it
  AND projects.workspace_id = workspaceId -- wrapper injects this again
```

The predicate appears twice on purpose. You write it so the boundary is visible in code review and type-checked by TypeScript. Strict mode verifies you didn't forget it, then the wrapper injects its own copy as a backstop. The duplicate is redundant in the SQL and costs nothing; what it buys is a thrown error instead of a silent cross-scope read when someone forgets the predicate.

Application code that should be scoped should receive the scoped DB handle, not the raw Drizzle instance.

The two approaches are not mutually exclusive, and neither is strictly "above" the other:

- **App-layer scoping (this package)** keeps isolation where your code lives: typed, reviewable, dialect-generic, and loud on mistakes. It can't constrain code that deliberately bypasses the scoped handle (see [Security model](#security-model)).
- **Database RLS** is a boundary the app can't bypass, but it's Postgres-only and carries the operational costs PlanetScale documents in [_RLS sounds great until it isn't_](https://planetscale.com/blog/rls-sounds-great-until-it-isnt): per-row policy evaluation, pooling friction, and silent failures.

Use app-layer scoping as your primary, visible guardrail; add RLS underneath when you also want a database-level boundary that holds even if app code goes around the wrapper. On MySQL, SingleStore, or other engines without RLS, app-layer scoping is the practical path.

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

Relational `with` entries are root-only today: `findFirst` / `findMany` are scoped, but nested relation rows rely on scope-safe relationships, explicit relation filters, or database constraints.

## Data model shape

This package works best when scope ownership is represented in your schema:

- scope columns on scoped tables
- scoped rules for protected tables
- indexes for scoped access paths, e.g. `(scope_id, id)` and `(scope_id, foreign_id)`
- globally unique IDs or constraints that reject invalid cross-scope references

Write rules explicitly for small schemas, or generate them once from schema metadata in an app-specific facade.

Explicit rules:

```ts
const rules = [
  scopeByColumn(projects, projects.workspaceId, { insertKey: "workspaceId" }),
  scopeByColumn(tasks, tasks.workspaceId, { insertKey: "workspaceId" }),
  scopeByColumn(comments, comments.workspaceId, { insertKey: "workspaceId" }),
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

With either shape, the wrapper can scope root tables and joined tables with rules. Your schema still owns data consistency, such as preventing a task in one scope from referencing another scope's project.

## Strict mode

Strict mode is enabled by default and intended for most app code. Scoped selects, updates, deletes, and relational queries must include a `where` clause with the declared scope predicate.

Callers write the scope predicate, the wrapper verifies it, then injects it again. If generated code, agent-authored code, or a rushed refactor forgets the predicate, the query throws.

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

The predicate must sit on the scoped table itself: filtering a joined table's same-named column (e.g. `eq(tasks.workspaceId, workspaceId)` while selecting `projects`) does not satisfy the check, though aliased self-joins still do.

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

The wrapper has two explicit escape hatches:

```ts
// Local escape: validate scoped insert first, then use raw Drizzle APIs.
workspaceDb
  .insert(projects)
  .values({ id, workspaceId, name })
  .$unsafeUnscoped()
  .onConflictDoUpdate({ target: projects.id, set: { name } });

// Root escape: bypass the scoped wrapper entirely.
workspaceDb._unsafeUnscopedDb;
```

Prefer `.$unsafeUnscoped()` for upserts/conflict handlers after scoped `.values(...)`. Use `_unsafeUnscopedDb` for migrations, admin jobs, test setup, cross-scope maintenance, raw SQL, or unsupported query shapes. Escaped queries are not scoped.

Scoped inserts expose a narrower, local escape for upserts. Conflict-resolution methods (`onConflictDoNothing` / `onConflictDoUpdate` / `onDuplicateKeyUpdate`) are withheld from the scoped insert result, because an upsert's conflict target, `set`, and `where` clauses fall outside the scope predicate that `.values(...)` injects. Reach them with `.$unsafeUnscoped()`, which returns the raw dialect builder already carrying the scoped values:

```ts
workspaceDb
  .insert(records)
  .values({ workspaceId, regionId, key, value }) // scope-validated here
  .$unsafeUnscoped()
  .onConflictDoUpdate({ target: [records.workspaceId, records.key], set: { value } });
```

The insert payload is still scope-validated, but you own the conflict target, `set`, and any follow-up `.where(...)`: keep the target scope-safe (prefer a unique key that includes the scope columns) and never let `set` move a row across scopes.

The wrapper scopes supported selects, joins, mutations, root relational queries, and validated inserts. The schema shape in [Data model shape](#data-model-shape) still matters: your data model needs ownership columns, indexes, and relationship invariants that match how your app scopes data.

Not protected:

- raw SQL, `_unsafeUnscopedDb`, or helpers that close over the raw DB
- query builder methods reached after `.$unsafeUnscoped()` or through `_unsafeUnscopedDb`
- tables or joined tables without rules
- nested relational `with` rows unless your relationships, filters, or constraints enforce scope safety
- invalid cross-scope rows that your database constraints allow
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
- `insert(table).values(...)`, plus `.returning(...)`, `.$returningId()` when supported, and `.$unsafeUnscoped()` for raw continuation
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
  // Required when createScopedDb({ strict: true }) is enabled.
  hasScopeInWhere?: (condition: SQL | undefined) => boolean;
};
```

### `assertDrizzleCompatibility(condition, expectedColumnName, expectedTable?)`

Optional startup assertion for projects that rely on `strict` mode or `containsColumnFilter`.

```ts
import { assertDrizzleCompatibility } from "@modemdev/drizzle-scoped-db";
import { eq } from "drizzle-orm";

// Name-only check (backward compatible)
assertDrizzleCompatibility(eq(projects.workspaceId, "compat-check"), "workspace_id");

// Table-aware check (recommended when using scopeByColumn's default detector)
assertDrizzleCompatibility(eq(projects.workspaceId, "compat-check"), "workspace_id", projects);
```

If a Drizzle upgrade changes the internal SQL chunk shape, this fails fast instead of letting strict validation silently return `false`. Pass the table to also verify that column chunks expose table identity for alias-safe disambiguation.

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

Release prep also records a committed performance and heap-growth snapshot:

```bash
pnpm bench:release
pnpm bench:release:compare
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
