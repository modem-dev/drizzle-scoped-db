# Changelog

All notable user-visible changes to this project are documented in this file.

## [Unreleased]

### Added

- Inject scope predicates for joined tables with declared rules in select query builders.
- Add an experimental POC for recursively scoping mapped relational `with` entries.

### Changed

- Expand README and security policy guidance around guardrails, RLS, schema requirements, and tenant-safe data models.
- Make strict mode the default and allow opting out with `strict: false`.

### Fixed

## [0.6.0] - 2026-06-23

### Added

- Initial standalone package setup with typed Drizzle scoped DB helpers.

### Changed

- Configure package for public npm publishing under `@modemdev/drizzle-scoped-db`.
