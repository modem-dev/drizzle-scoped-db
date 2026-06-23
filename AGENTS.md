# AGENTS.md

## Project

`drizzle-scoped-db` is a TypeScript library that wraps Drizzle ORM database handles with typed tenant/scope guardrails.

## Important files

- `src/index.ts` — public API and implementation.
- `src/scoped-db.test.ts` — Vitest coverage for query wrapping, strict validation, transactions, and helpers.
- `README.md` — OSS-facing package documentation.
- `CHANGELOG.md` — user-visible change log.

## Working rules

- Keep the public API small and stable.
- Preserve dialect-generic Drizzle core types where possible.
- Treat `_unsafeUnscopedDb` as an intentionally loud escape hatch.
- Do not add Modem-internal dependencies to this standalone package.
- Prefer behavior-focused tests over implementation-only assertions.

## Validation

Run before merging:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
```

## Changelog

Maintain `CHANGELOG.md` as the source of truth for user-visible changes.

- Keep upcoming work under `## [Unreleased]`.
- Use `### Added`, `### Changed`, and `### Fixed` subsections.
- Append to existing subsections instead of creating duplicates.
- When cutting a release, move relevant entries into a new immutable version section and start a fresh `## [Unreleased]` section.

## Commits

Use Conventional Commits: `<type>[scope]: <description>`.
