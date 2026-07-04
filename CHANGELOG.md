# Changelog

All notable user-visible changes to this project are documented in this file.

## [Unreleased]

### Added

- Add real-driver PostgreSQL and SQLite integration coverage for scoped joins, including joined-table scope predicates, left-join outer-row preservation, unscoped roots joined to scoped tables, and fail-closed joined aliases.
- Add real-driver `selectDistinct` / PostgreSQL `selectDistinctOn` coverage plus public type-surface checks for real dialect DB types and emitted declarations.
- Add real-driver PostgreSQL and SQLite mutation coverage for strict-false bulk updates/deletes, awaitable inserts/upserts without `returning()`, guarded runtime mutation surfaces, and transaction mutation rollback/no-op behavior.

### Changed

- Document strict-mode validation as syntactic scope-context detection, with regression coverage that the injected predicate remains the authoritative runtime guard.

### Fixed

- Block scoped mutation and insert result proxies from forwarding unknown raw Drizzle builder methods, preventing post-scope builder escapes such as PostgreSQL update `.from(...).where(...)` from overwriting injected scope predicates.
- Fail closed for Drizzle relational query `with` includes on scoped wrappers, preventing nested relation loads from bypassing scoped table rules until nested scoping is supported.
- Fail closed when a scoped table rule cannot produce its scope predicate, preventing custom rules from accidentally executing protected selects, joins, updates, or deletes without defense-in-depth scope injection.
- Validate cached scoped rule indexes against the current rules array contents, avoiding stale lookups if callers mutate a rules array between `createScopedDb(...)` calls.
- Preserve synchronous transaction callback semantics for sync Drizzle drivers, allowing scoped SQLite/sql.js transactions to roll back on synchronous callback errors instead of forcing an async callback wrapper.
- Forward scoped mutation `.run()` terminal execution when the underlying dialect exposes it, so sync drivers can execute scoped mutations inside synchronous transaction callbacks without reopening raw builder chaining.

## [0.11.0] - 2026-06-30

### Added

- Add Drizzle 1.0 RQBv2 relational object-filter scoping for `scopeByColumn` rules, including fail-closed handling for unsupported relational where shapes and custom rules without RQBv2 object-filter support.

### Changed

- Clean `dist` and the TypeScript build-info cache before `pnpm build`, preventing stale local package artifacts after source files move or are deleted.

## [0.10.1] - 2026-06-30

### Fixed

- Restore strict relational `db.query.*` where-callback scope detection when schema keys differ from SQL table names, preventing false missing-scope errors for correctly scoped queries.

## [0.10.0] - 2026-06-30

### Added

- Scoped PostgreSQL/SQLite `.onConflictDoUpdate(...)` now injects the table rule's `where(scopeValue)` predicate into `setWhere`, so cross-scope conflicts safely no-op.

### Changed

- Relax scoped PostgreSQL/SQLite `.onConflictDoUpdate(...)` conflict-target validation: any conflict target is allowed while insert/update payload validators still run and scope-column reassignment still throws.
- Stop exposing raw `execute` on scoped wrappers; use `_unsafeUnscopedDb.execute(...)` when intentionally running raw SQL.
- Reject aliases of scoped tables unless the alias has its own explicit scoped rule, preventing aliases from silently bypassing rule lookup.

### Fixed

- Prevent scoped insert/update/delete result chaining from leaking raw Drizzle builders through `.returning()`, second `.where(...)`, or `$dynamic()`.

## [0.9.0] - 2026-06-29

### Added

- Expose scoped PostgreSQL/SQLite `.onConflictDoUpdate(...)` and `.onConflictDoNothing(...)` after `.values(...)`; conflict updates are forwarded only after runtime validation proves the conflict target includes the scope and the `set` payload cannot move the row across scopes.
- Add `InvalidScopedConflictTargetError` and the `invalidConflictTarget` error hook for scoped upsert validation failures.

## [0.8.0] - 2026-06-27

### Added

- Forward dialect-native terminal methods through scoped mutation results when the underlying builder provides them: `.returning(...)` on scoped insert/update/delete (Postgres/SQLite), and `.$returningId()` on scoped inserts (MySQL). Each method stays hidden for dialects that lack it (for example MySQL exposes no RETURNING clause).
- Add `.$unsafeUnscoped()` on scoped insert results: a loud, local escape that returns the raw dialect insert builder (already carrying the scoped `.values(...)` payload) so conflict/upsert methods can be chained explicitly, e.g. `db.insert(tbl).values(row).$unsafeUnscoped().onConflictDoUpdate(...)`. The conflict methods (`onConflictDoNothing` / `onConflictDoUpdate` / `onDuplicateKeyUpdate`) are intentionally withheld from the scoped result itself, because an upsert's conflict target, `set`, and `where` clauses fall outside the scope predicate that `.values(...)` injects and must be audited at the call site.
- Expose `.groupBy(...)` and `.having(...)` on scoped select query builders so aggregate queries can be expressed through the guardrailed facade instead of dropping to the raw handle.

### Changed

- `createScopedDb` now returns an explicit scoped wrapper type instead of the raw database type, so TypeScript no longer exposes raw Drizzle builder methods that the protected scoped facade does not provide.
- Scoped `.returning(...)` now infers row types from the target table (and projection columns) instead of degrading to `unknown`, so destructured/awaited insert/update/delete results stay precisely typed.
- `InferSelection` now preserves `sql<T>` fragments, aliased `sql<T>().as()` fragments, and nested selection objects (previously collapsed to `never`), and falls back to `unknown` rather than `never` for unrecognized leaves, keeping custom projections usable downstream.
- Scoped `.leftJoin(...)` / `.innerJoin(...)` now accept `SQL | undefined` for the join condition, matching Drizzle's own signature and the result of composing predicates with `and(...)` / `or(...)`.

### Fixed

- Scoped `.values(...)` / `.set(...)` payloads now accept Drizzle `sql` template expressions for individual column values, matching Drizzle's own insert/update signatures (previously a raw `SQL` column value was rejected by the scoped payload type).
- `.$unsafeUnscoped()` now returns a builder whose conflict/upsert chains preserve the table-precise `.returning(...)` row type instead of widening to `Record<string, unknown>`, so `db.insert(tbl).values(row).$unsafeUnscoped().onConflictDoUpdate(...).returning()` stays column-accurate.

## [0.7.0] - 2026-06-26

### Added

- Inject scope predicates for joined tables with declared rules in select query builders.
- Add `InvalidScopedUpdateError` and update payload validation via `updateKey` (falls back to `insertKey`) to prevent scope column reassignment during updates.
- Add Drizzle ORM 1.0 release candidate peer dependency support and CI compatibility checks.
- Add repository social preview artwork, before/after diagram, and release benchmark gate.

### Changed

- Make strict mode the default; opt out with `strict: false`.
- Reframe README: scope-first positioning (tenant as example), TL;DR, badges, RLS comparison table, and use cases section.

### Fixed

- Prevent double `.where()` from overwriting the injected scope predicate — scoped builders now return facades that hide scope-unsafe methods.
- Inject scope predicates for joined tables even when the root table is unscoped, closing a read-path leak.
- Strict-mode scope detection now matches the table's original (pre-alias) name, fixing false positives when joined tables share a column name while remaining safe for aliased self-joins.

## [0.6.0] - 2026-06-23

### Added

- Initial standalone package setup with typed Drizzle scoped DB helpers.

### Changed

- Configure package for public npm publishing under `@modemdev/drizzle-scoped-db`.
