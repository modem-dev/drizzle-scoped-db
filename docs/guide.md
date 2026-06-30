# Guide

`drizzle-scoped-db` is an application-layer guardrail for Drizzle ORM. It helps keep a required predicate on every scoped query: tenant, org, workspace, user, region, soft-delete, visibility, or any predicate your app must not forget.

## Where this fits

The library wraps a Drizzle database handle and returns a scoped handle. Application code that should be scoped receives that scoped capability instead of the raw DB.

```ts
const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules,
});
```

The wrapper scopes supported query builders. Tables without rules pass through unchanged.

## Use cases

- **Tenant or org isolation.** Keep `tenant_id = currentTenant` or `org_id = currentOrg` on every query.
- **Per-user data.** Force `user_id = currentUser` on private rows.
- **Region or data residency.** Keep `region = 'eu'` on every query.
- **Soft deletes.** Always exclude deleted rows with a custom `isNull(table.deletedAt)` rule.
- **Visibility.** Use a read handle that injects `published = true` so public endpoints never surface drafts.
- **Row-level ACLs.** Express composite predicates such as `owner_id = me OR shared_with @> me` with `defineScopedTable`.

## Data model shape

The guardrail works best when scope ownership is represented in your schema:

- scope columns on scoped tables
- scoped rules for protected tables
- indexes for scoped access paths, for example `(scope_id, id)` and `(scope_id, foreign_id)`
- globally unique IDs or constraints that reject invalid cross-scope references

Write rules explicitly for small schemas:

```ts
const rules = [
  scopeByColumn(projects, projects.workspaceId, { insertKey: "workspaceId" }),
  scopeByColumn(tasks, tasks.workspaceId, { insertKey: "workspaceId" }),
  scopeByColumn(comments, comments.workspaceId, { insertKey: "workspaceId" }),
];
```

Or generate them once from app-specific schema metadata:

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

Your database schema still owns data consistency, such as preventing a task in one scope from referencing another scope's project.

## Strict mode

Strict mode is enabled by default. Scoped selects, updates, deletes, and relational root queries must include a `where` clause with the declared scope predicate.

Callers write the scope predicate, the wrapper verifies it, then injects it again. If human-written code, generated code, or agent-authored code forgets the predicate, the query throws.

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

// Allowed; the wrapper still injects its own scope predicate.
await workspaceDb
  .select()
  .from(projects)
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
```

Conceptually, strict mode makes scoped reads look like this:

```sql
WHERE projects.id = projectId
  AND projects.workspace_id = workspaceId -- caller wrote this; strict mode checks it
  AND projects.workspace_id = workspaceId -- wrapper injects this again
```

The duplicate predicate is intentional. It keeps the boundary visible in code review and adds a generated backstop.

The predicate must sit on the scoped table itself. Filtering a joined table's same-named column does not satisfy the check for the root table. Aliases of scoped tables are rejected unless the alias has its own explicit scoped rule, so aliases cannot silently bypass rule lookup.

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

## Selects and joins

Scope predicates are injected into scoped root tables. Joined tables with declared rules receive their own predicates too. For joins, the joined table predicate is added to the join condition so `leftJoin` keeps outer-join behavior.

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

## Inserts, updates, and deletes

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

Batch inserts are validated row by row. Updates use `updateKey` when provided, otherwise `insertKey` is used as the fallback update validator.

```ts
await workspaceDb
  .update(tasks)
  .set({ status: "done" })
  .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));

await workspaceDb
  .delete(tasks)
  .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
```

## Scoped upserts

PostgreSQL/SQLite conflict updates can stay on the scoped facade with any conflict target when the update payload cannot move the row across scopes.

```ts
await workspaceDb
  .insert(records)
  .values({ workspaceId, regionId, key, value })
  .onConflictDoUpdate({ target: records.key, set: { value } });
```

The wrapper forwards your `target`, `set`, and `targetWhere`, then injects the rule's scope predicate into `setWhere`. If a conflict points at a row from another scope, the guarded `DO UPDATE ... WHERE scope = value` is false, so the conflict safely no-ops instead of updating or inserting.

For `scopeByColumn`, configure `insertKey` to validate `.values(...)` and `set` payloads. Use `updateKey` when the update payload field differs from the insert field. Custom `defineScopedTable` rules can opt in with `validateInsert` and `validateUpdate`.

Use `.$unsafeUnscoped()` for targetless MySQL upserts, custom rules without upsert validators, or deliberate cross-scope writes.

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

Relational `with` entries are root-only today: `findFirst` / `findMany` are scoped, but nested relation rows rely on scope-safe relationships, explicit relation filters, or database constraints.

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
      validateUpdate: (payload, scope) =>
        (!payload.workspaceId || payload.workspaceId === scope.workspaceId) &&
        (!payload.regionId || payload.regionId === scope.regionId),
    }),
  ],
});
```

Add `hasScopeInWhere` if strict validation should inspect caller-provided predicates for a custom rule.

## Escape hatches

`ScopedDb` intentionally does not mirror the full Drizzle API. It covers the common guarded path without pretending every advanced Drizzle shape is scope-safe.

### Local escape: `.$unsafeUnscoped()`

Use after scoped insert validation for conflict handlers the scoped facade intentionally will not guard.

```ts
workspaceDb
  .insert(records)
  .values({ workspaceId, regionId, key, value })
  .$unsafeUnscoped()
  .onConflictDoUpdate({ target: records.key, set: { workspaceId: newWorkspaceId } });
```

The inserted values were checked, but the conflict target, `set`, and follow-up `where` clauses are yours to keep scope-safe.

### Root escape: `_unsafeUnscopedDb`

Use when there is no scoped chain to start from:

```ts
workspaceDb._unsafeUnscopedDb;
```

Common cases: migrations, admin jobs, test setup, cross-scope maintenance, raw SQL, CTEs/subqueries, `$dynamic`, or query shapes the scoped facade does not model.

## Security model

`drizzle-scoped-db` protects supported Drizzle query-builder calls that go through the scoped wrapper. It is not a complete database isolation system and cannot protect code that bypasses the scoped capability.

Protected paths include supported selects, joins, mutations, root relational queries, validated inserts, transactions, and safe PostgreSQL/SQLite upserts. The schema shape still matters: your data model needs ownership columns, indexes, and relationship invariants that match how your app scopes data.

Not protected:

- raw SQL, `_unsafeUnscopedDb`, or helpers that close over the raw DB
- query builder methods reached after `.$unsafeUnscoped()` or through `_unsafeUnscopedDb`
- tables or joined tables without rules
- nested relational `with` rows unless relationships, filters, or constraints enforce scope safety
- invalid cross-scope rows that database constraints allow
- deliberate bypasses of the scoped DB capability

RLS, database permissions, and other database-native controls can be layered with scoped handles when you need enforcement outside the typed application query-builder path.

## How this relates to RLS

RLS is enforced by the database. `drizzle-scoped-db` is enforced by the application path: scoped code receives a scoped Drizzle handle instead of the raw DB. It focuses on typed query builders, explicit scoped capabilities, and loud failures when predicates are missing.

|                       | Enforcement layer | Isolation model                    | DB lock-in             | Catches app-code mistakes |
| --------------------- | ----------------- | ---------------------------------- | ---------------------- | ------------------------- |
| **drizzle-scoped-db** | App query builder | Shared tables + injected predicate | None (dialect-generic) | Yes, typed + loud errors  |
| Drizzle native RLS    | Database          | Shared tables + row policies       | Postgres-only          | Enforced below the app    |
| drizzle-multitenant   | App middleware    | Schema-per-tenant                  | Postgres-only          | Different model           |
| pgvpd                 | Proxy / wire      | RLS via protocol proxy             | Postgres-only          | No                        |
| Nile                  | DB vendor         | Virtual tenant DBs                 | Nile-specific          | No                        |

The approaches can be layered. Use app-layer scoping as a visible guardrail in application code; add RLS underneath when you also want a database-level boundary that holds even if app code goes around the wrapper. On MySQL, SingleStore, SQLite, or other engines without RLS, app-layer scoping is the practical path.

PlanetScale's [_RLS sounds great until it isn't_](https://planetscale.com/blog/rls-sounds-great-until-it-isnt) covers common operational tradeoffs around RLS, including per-row policy evaluation, pooling friction, and silent failures.

## Dialect support

The package uses Drizzle core `Table`, `Column`, and `SQL` types, so rules are not tied to `pg-core`.

Expected support:

- PostgreSQL
- SQLite
- MySQL
- SingleStore
- any Drizzle driver with the standard `select`, `insert`, `update`, `delete`, and optional `query` APIs

`selectDistinctOn` is exposed only when the wrapped Drizzle instance provides it, primarily PostgreSQL.
