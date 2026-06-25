# Changelog

All notable user-visible changes to this project are documented in this file.

## [Unreleased]

### Added

- Add repository social preview artwork for Open Graph/Twitter cards.
- Add a before/after diagram (`assets/before-after.png`) illustrating a forgotten scope filter, embedded in the README.
- Add release benchmark snapshots and a release workflow gate for performance and heap-growth regressions.
- Inject scope predicates for joined tables with declared rules in select query builders.

### Changed

- Add Drizzle ORM 1.0 release candidate peer dependency support and CI compatibility checks.
- Expand README and security policy guidance around guardrails, RLS, schema requirements, and tenant-safe data models.
- Lead the README with a pain-focused hook, a TL;DR, badges, and a "Where this fits" positioning table comparing app-layer scoping against RLS, schema-per-tenant, proxy, and DB-vendor approaches.
- Frame scoping as a guardrail for any required query predicate (tenant, user, region, soft-delete, visibility, ACLs), add a "Use cases" README section, and reword the social card to "unscoped queries".
- Reframe RLS guidance to present app-layer scoping as a legitimate primary strategy (loud failures, dialect-generic) rather than a complement, noting RLS's documented operational trade-offs and Postgres-only scope.
- Make strict mode the default and allow opting out with `strict: false`.

### Fixed

- Strict-mode scope detection now matches the table's original (pre-alias) name in addition to the column name, preventing false positives when a joined table shares a column name with the scoped table while remaining safe for aliased self-joins.

## [0.6.0] - 2026-06-23

### Added

- Initial standalone package setup with typed Drizzle scoped DB helpers.

### Changed

- Configure package for public npm publishing under `@modemdev/drizzle-scoped-db`.
