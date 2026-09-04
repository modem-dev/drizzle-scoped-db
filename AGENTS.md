# AGENTS.md

## Project

`drizzle-scoped-db` is a TypeScript library that wraps Drizzle ORM database handles with typed scope guardrails. The scope can be a tenant, org, user, region, soft-delete flag, or any predicate a query must never forget.

## Important files

- `src/index.ts` — public exports.
- `src/scoped-db.ts` — root scoped DB wrapper and transaction wrapping.
- `src/rules.ts` — public declarative rule helpers (`scopeByColumn`, `scopeByPredicate`) and internal bespoke rule construction.
- `src/internal/select.ts` — scoped select/join facades.
- `src/internal/mutations.ts` — scoped insert/update/delete facades, upsert guarding, and mutation-result escape prevention.
- `src/internal/relational.ts` — scoped Drizzle relational query wrappers.
- `src/internal/scope.ts` — strict validation, scope predicate composition, and error factories.
- `src/internal/options.ts` — option normalization and scoped table rule lookup.
- `src/drizzle-compat.ts` — Drizzle SQL chunk inspection helpers used by strict validation.
- `tests/unit/` — fake-builder Vitest suites grouped by behavior: select guardrails, mutation guardrails, relational wrappers, API surface, custom rules/errors, and Drizzle compatibility helpers.
- `tests/integration/` — real-driver integration suites for Postgres/PGlite and SQLite.
- `README.md` — OSS-facing package documentation.
- `CHANGELOG.md` — user-visible change log.

## Working rules

- Keep the public API small and stable: optimize for the common 90–95% of scoped query needs, not the full Drizzle API.
- Keep rule declaration declarative for users: prefer `scopeByColumn(...)` (single or composite equality scopes) and `scopeByPredicate(...)` (non-equality predicates). Do not re-expose low-level custom rule hooks or add bespoke public options for edge cases unless there is a strong API-design reason; rare cases should use loud unsafe escapes.
- Treat the scoped facade as a narrow safe subset. Advanced builder shapes must be explicitly modeled with tests or fail loud/fail closed behind `_unsafeUnscopedDb` / `.$unsafeUnscoped()`.
- Preserve dialect-generic Drizzle core types where possible within that supported surface.
- Do not expose unloud raw Drizzle builder escape paths from scoped facades; be especially careful with fluent methods like `.where(...)`, `.returning(...)`, `$dynamic()`, and conflict/upsert methods.
- Fail closed for ambiguous scoped table aliases unless the alias has its own explicit scoped rule.
- Keep strict validation honest: it checks that caller predicates mention configured scope context; the wrapper's injected predicate is the authoritative guard. Do not document strict mode as semantic proof of equality to the active scope value.
- Keep scoped upserts safe by deriving guards from `rule.where(scopeValue)` and injecting them into `setWhere`; do not require conflict targets to include the scope column.
- Do not add application-internal dependencies to this standalone package.
- Prefer behavior-focused tests over implementation-only assertions, especially security regression tests for scope bypasses and escape boundaries.
- Exercise database behavior against a real driver in `tests/integration/` (PGlite/SQLite), not mocks. The fake-builder unit suites in `tests/unit/` are for fast guardrail logic; they do not reproduce Drizzle runtime behavior (e.g. how the relational query API aliases callback columns), so they must not be the only coverage for anything that depends on real query construction. When a bug only reproduces against a real database, add or extend an integration test — do not pave over it with a mock that asserts the convenient shape.

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

Integration tests under `tests/integration/` run as part of `pnpm test` and CI's locked/RC Drizzle matrix. They must run against a real driver — when an API only exists on one Drizzle line (for example, the schema-only relational callback `where` predates the 1.0 RQBv2 object-filter API), feature-detect and skip transparently on the unsupported matrix rather than mocking the database to force a pass.

For changes that add proxies, wrappers, hot-path query guards, or other performance-sensitive behavior, also run the release benchmarks and compare against the latest committed baseline:

```bash
pnpm bench:release
pnpm bench:release:compare
```

For unreleased branch checks that should not write a versioned snapshot, run `node --expose-gc benchmarks/run-release.mjs --version <next-version> --out /tmp/drizzle-scoped-db-head-bench.json` and compare with `scripts/compare-release-benchmarks.mjs --base benchmarks/release/<baseline>.json --head /tmp/drizzle-scoped-db-head-bench.json`.

For changes to public builder types (`src/types.ts`, projection or join inference, mutation payload types), also run the type-check benchmark, which measures `tsc` counters for the fixed consumer workload in `benchmarks/types/consumer.ts`:

```bash
pnpm bench:types -- --out /tmp/drizzle-scoped-db-head-types.json
pnpm bench:types:compare -- --head /tmp/drizzle-scoped-db-head-types.json --base-latest
```

CI runs the same comparison on the locked Drizzle matrix. `types/type_count` and `types/instantiation_count` gate at `+20%` and `+5000`; timing and memory are informational. Do not edit the consumer workload to make a comparison pass; regenerate the committed snapshot only when the workload, TypeScript, or Drizzle intentionally changes, and say so in the change. At release prep, `pnpm bench:types` writes the versioned `benchmarks/release/types-x.y.z.json` alongside the runtime snapshot.

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
