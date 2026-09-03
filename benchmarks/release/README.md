# Release benchmark snapshots

Committed files in this directory are the performance and memory baselines used by the release workflow. They are intentionally versioned so a release can be audited after publishing.

## Release prep

Before pushing a release tag, run the benchmark suite for the version in `package.json`:

```bash
pnpm bench:release
```

This writes:

```text
benchmarks/release/bench-x.y.z.json
```

Then compare it against the latest lower stable release snapshot:

```bash
pnpm bench:release:compare
```

Commit the new `bench-x.y.z.json` file with the release-prep change. The tag release workflow validates that this file exists and fails if the comparison finds a material regression.

The first release snapshot establishes the baseline. Later releases compare against the latest lower stable version in this directory.

## Regression policy

The gate compares benchmark medians and only fails on regressions that exceed both the relative and absolute thresholds embedded in the benchmark result metadata:

- timing metrics: default `+25%` and at least `+10ms`
- heap growth metrics: default `+30%` and at least `+2MiB`

New metrics are informational until a later release has a baseline. Missing previously comparable metrics fail, because that means the gate can no longer protect that measurement.

If a release intentionally accepts a measured tradeoff, record the metric names and rationale in the new snapshot's `acceptedRegressions` array. The comparison report will mark those rows as accepted instead of failing, while preserving the audit trail in the committed release artifact.

## Type-check benchmark snapshots

`types-x.y.z.json` files are the type-level counterpart: they record `tsc --extendedDiagnostics` counters for the fixed consumer workload in `benchmarks/types/consumer.ts`, which type-checks the public scoped surface (whole-row and projected selects, joins, mutations with returning, transactions) on PostgreSQL and SQLite. Type inference that leans on Drizzle's conditional types is paid by every consumer `tsc` run, so regressions here are tracked like runtime regressions.

Release prep writes and compares the snapshot the same way:

```bash
pnpm bench:types
pnpm bench:types:compare
```

To check an unreleased branch against the latest committed snapshot without writing a versioned file:

```bash
pnpm bench:types -- --out /tmp/types-head.json
pnpm bench:types:compare -- --head /tmp/types-head.json --base-latest
```

CI runs that comparison on the locked Drizzle matrix for every pull request.

Only the deterministic counters gate: `types/type_count` and `types/instantiation_count` fail on `+20%` and at least `+5000`. `types/check_time_ms` and `types/memory_used_bytes` are informational because they vary by machine. Snapshots record the TypeScript and Drizzle versions they were taken with; counts shift when either is upgraded, so regenerate the snapshot in the same change that upgrades them.
