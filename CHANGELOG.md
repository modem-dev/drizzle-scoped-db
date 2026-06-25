# Changelog

All notable user-visible changes to this project are documented in this file.

## [Unreleased]

### Added

- Add repository social preview artwork for Open Graph/Twitter cards.
- Add release benchmark snapshots and a release workflow gate for performance and heap-growth regressions.
- Inject scope predicates for joined tables with declared rules in select query builders.

### Changed

- Add Drizzle ORM 1.0 release candidate peer dependency support and CI compatibility checks.
- Expand README and security policy guidance around guardrails, RLS, schema requirements, and tenant-safe data models.
- Lead the README with a pain-focused hook, a TL;DR, badges, and a "Where this fits" positioning table comparing app-layer scoping against RLS, schema-per-tenant, proxy, and DB-vendor approaches.
- Reframe RLS guidance to present app-layer scoping as a legitimate primary strategy (loud failures, dialect-generic) rather than a complement, noting RLS's documented operational trade-offs and Postgres-only scope.
- Make strict mode the default and allow opting out with `strict: false`.

### Fixed

## [0.6.0] - 2026-06-23

### Added

- Initial standalone package setup with typed Drizzle scoped DB helpers.

### Changed

- Configure package for public npm publishing under `@modemdev/drizzle-scoped-db`.
