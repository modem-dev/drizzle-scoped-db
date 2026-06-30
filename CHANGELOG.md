# Changelog

All notable user-visible changes to this project are documented in this file.

## [Unreleased]

### Added

### Changed

### Fixed

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
