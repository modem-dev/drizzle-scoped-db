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
