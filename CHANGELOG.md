# Changelog

All notable user-visible changes to this project are documented in this file.

## [Unreleased]

### Changed

- `createScopedDb` now returns an explicit scoped wrapper type instead of the raw database type, so TypeScript no longer exposes raw Drizzle builder methods that the protected scoped facade does not provide.

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
