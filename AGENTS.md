# AGENTS.md

## Project

`drizzle-scoped-db` is a TypeScript library that wraps Drizzle ORM database handles with typed scope guardrails. The scope can be a tenant, org, user, region, soft-delete flag, or any predicate a query must never forget.

## Important files

- `src/index.ts` — public API and implementation.
- `src/scoped-db.test.ts` — Vitest coverage for query wrapping, strict validation, transactions, and helpers.
- `README.md` — OSS-facing package documentation.
- `CHANGELOG.md` — user-visible change log.

## Working rules

- Keep the public API small and stable.
- Preserve dialect-generic Drizzle core types where possible.
- Treat `_unsafeUnscopedDb` as an intentionally loud escape hatch.
- Do not add application-internal dependencies to this standalone package.
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

## Releases

The release workflow expects a committed benchmark snapshot before the tag is pushed.

1. Bump `version` in `package.json`.
2. Move `## [Unreleased]` entries into a new `## [x.y.z] - YYYY-MM-DD` section in `CHANGELOG.md`.
3. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm coverage && pnpm build`.
4. Run `pnpm bench:release` — generates `benchmarks/release/bench-<version>.json`.
5. Commit the version bump, changelog, and benchmark snapshot together.
6. Merge the release PR to main.
7. Tag: `git tag v<version> && git push origin v<version>`.
8. Publish: `pnpm publish`.

Do **not** push the tag before the benchmark file lands on main — the CI `bench:release:compare` gate will fail.
