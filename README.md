# drizzle-scoped-db

Typed scoped Drizzle ORM handles for apps that must never forget tenant, org, user, region, visibility, or soft-delete predicates.

[![CI](https://github.com/modem-dev/drizzle-scoped-db/actions/workflows/ci.yml/badge.svg)](https://github.com/modem-dev/drizzle-scoped-db/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@modemdev/drizzle-scoped-db.svg)](https://www.npmjs.com/package/@modemdev/drizzle-scoped-db)
[![types](https://img.shields.io/npm/types/@modemdev/drizzle-scoped-db.svg)](https://www.npmjs.com/package/@modemdev/drizzle-scoped-db)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)](#testing)
[![license](https://img.shields.io/npm/l/@modemdev/drizzle-scoped-db.svg)](./LICENSE)

`drizzle-scoped-db` wraps a Drizzle database handle with a smaller scoped facade. Code that receives `workspaceDb`, `tenantDb`, or `orgDb` gets scope predicates injected automatically, strict runtime checks by default, and loud errors when a scoped query forgets its boundary.

<p align="center">
  <img src="./assets/before-after.png" width="820" alt="With a plain Drizzle handle a forgotten org filter silently returns every org's rows; with a drizzle-scoped-db handle the same query throws MissingScopedWhereError, caught before it ships." />
</p>

## Why use it

- **Strict by default.** Missing `where` clauses or missing scope predicates throw instead of silently returning cross-scope rows.
- **Typed scoped capabilities.** Pass scoped DB handles through app code instead of the raw Drizzle handle.
- **Defense in depth.** Callers write the scope predicate for review; the wrapper validates it and injects its own predicate too.
- **Covers common Drizzle paths.** Selects, joins, inserts, updates, deletes, transactions, root relational queries, and safe PostgreSQL/SQLite upserts.
- **Dialect-generic.** Uses Drizzle core `Table`, `Column`, and `SQL` types; tested with Postgres/PGlite and SQLite/sql.js.

## Install

```bash
npm install @modemdev/drizzle-scoped-db drizzle-orm
```

```bash
pnpm add @modemdev/drizzle-scoped-db drizzle-orm
```

Drizzle is a peer dependency. This package supports `drizzle-orm >=0.45.2` and the Drizzle 1.0 release candidate line.

## Quick start

```ts
import { createScopedDb, scopeByColumn } from "@modemdev/drizzle-scoped-db";
import { and, eq } from "drizzle-orm";
import { projects, tasks } from "./schema";

const workspaceDb = createScopedDb(db, {
  scopeName: "workspace",
  scopeValue: workspaceId,
  rules: [
    scopeByColumn(projects, projects.workspaceId, { insertKey: "workspaceId" }),
    scopeByColumn(tasks, tasks.workspaceId, { insertKey: "workspaceId" }),
  ],
});

const project = await workspaceDb
  .select()
  .from(projects)
  .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
```

Strict mode verifies the caller included `eq(projects.workspaceId, workspaceId)`, then the wrapper injects its own copy as a backstop.

```ts
// Throws MissingScopedWhereError
await workspaceDb.select().from(projects);

// Throws MissingScopedPredicateError
await workspaceDb.select().from(projects).where(eq(projects.id, projectId));
```

## Common patterns

### Scoped writes

```ts
await workspaceDb.insert(projects).values({
  id: projectId,
  workspaceId,
  name: "Roadmap",
});

await workspaceDb
  .update(tasks)
  .set({ status: "done" })
  .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));

await workspaceDb
  .delete(tasks)
  .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
```

When `insertKey` is configured, inserts are validated before they reach the database. Updates can also reject scope-column reassignment.

### Scoped upserts

PostgreSQL/SQLite conflict updates stay on the scoped facade when the insert and update payloads are scope-safe:

```ts
await workspaceDb
  .insert(projects)
  .values({ id: projectId, workspaceId, name: "Roadmap" })
  .onConflictDoUpdate({
    target: projects.id,
    set: { name: "Roadmap" },
  });
```

The wrapper forwards your conflict config and injects the scope predicate into `setWhere`, so a conflict against a row in another scope no-ops instead of updating that row.

### Escape hatches

Scoped handles intentionally do not expose every raw Drizzle method. Use the loud escapes when you are deliberately leaving the guardrail:

```ts
// Continue from a scope-validated insert into a raw dialect-specific chain.
workspaceDb
  .insert(projects)
  .values({ id: projectId, workspaceId, name: "Roadmap" })
  .$unsafeUnscoped();

// Use the raw DB for migrations, admin jobs, raw SQL, CTEs, or cross-scope maintenance.
workspaceDb._unsafeUnscopedDb;
```

## Performance

Scoped wrappers add proxy/facade work around Drizzle builders, so releases include benchmark and heap-growth snapshots.

- Run locally with `pnpm bench:release`.
- Compare against the latest committed baseline with `pnpm bench:release:compare`.
- Snapshots live in [`benchmarks/release/`](benchmarks/release/) and are generated during release prep.
- The release gate fails on material timing or heap regressions unless the snapshot explicitly records an accepted tradeoff.

See [`benchmarks/release/README.md`](benchmarks/release/README.md) for thresholds and workflow details.

## Testing

The project currently enforces 100% source coverage:

```text
Statements   : 100%
Branches     : 100%
Functions    : 100%
Lines        : 100%
```

Test coverage includes:

- behavior-focused unit tests under [`tests/unit/`](tests/unit/)
- real-driver integration tests under [`tests/integration/`](tests/integration/)
- Postgres coverage via PGlite
- SQLite coverage via sql.js
- CI matrix checks for locked Drizzle and `drizzle-orm@rc`

Run the same checks CI runs:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
```

## Docs

- [Guide](docs/guide.md): use cases, strict mode, custom rules, relational queries, security model, RLS comparison, and dialect support.
- [API reference](docs/api.md): exported functions, options, error types, and wrapped APIs.
- [Benchmarks](benchmarks/release/README.md): release benchmark snapshots and regression policy.
- [Security policy](SECURITY.md): how to report vulnerabilities.
- [Changelog](CHANGELOG.md): release history.

## Security

Please report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

`drizzle-scoped-db` protects supported Drizzle query-builder calls that go through the scoped wrapper. It is an application-layer guardrail, not a complete database isolation system, and it cannot protect code that bypasses the scoped capability. Layer database permissions, constraints, or RLS underneath when you need a database-enforced boundary too.

Read the full [security model](docs/guide.md#security-model).

## Contributing

Issues and focused pull requests are welcome. Before opening a PR, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
```

For performance-sensitive wrapper or proxy changes, also run the benchmark commands above.

## Support

Use [GitHub issues](https://github.com/modem-dev/drizzle-scoped-db/issues) for bug reports, feature requests, and documentation gaps.

## Sponsor

Sponsored by [Modem](https://modem.dev?utm_source=github&utm_medium=oss&utm_campaign=oss_drizzle_scoped_db&utm_content=readme_footer).

<a href="https://modem.dev?utm_source=github&utm_medium=oss&utm_campaign=oss_drizzle_scoped_db&utm_content=readme_footer">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://modem.dev/images/logo/svg/modem-combined-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://modem.dev/images/logo/svg/modem-combined-black.svg">
    <img src="https://modem.dev/images/logo/svg/modem-combined-black.svg" alt="Modem" width="220">
  </picture>
</a>

## License

MIT. See [LICENSE](LICENSE).
