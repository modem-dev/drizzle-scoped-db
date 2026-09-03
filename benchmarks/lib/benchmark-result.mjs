/** Return percentile values using nearest-rank indexing over sorted samples. */
export function percentile(samples, percentileValue) {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/** Infer display and comparison metadata from the metric name emitted by a benchmark. */
export function classifyMetric(name) {
  if (name.endsWith("_ms")) {
    return {
      unit: "ms",
      comparable: true,
      threshold: { maxRegressionRatio: 1.25, minAbsoluteRegression: 10 },
    };
  }

  if (name.includes("heap") || name.includes("rss")) {
    return {
      unit: "bytes",
      comparable: true,
      threshold: { maxRegressionRatio: 1.3, minAbsoluteRegression: 2 * 1024 * 1024 },
    };
  }

  if (name.endsWith("_bytes")) {
    return { unit: "bytes", comparable: false };
  }

  if (name.endsWith("_count")) {
    return {
      unit: "count",
      comparable: true,
      threshold: { maxRegressionRatio: 1.2, minAbsoluteRegression: 5000 },
    };
  }

  return { unit: "count", comparable: false };
}

/** Build an aggregated result from raw numeric samples. */
export function aggregateMetric(source, name, samples) {
  const classification = classifyMetric(name);
  const sorted = [...samples].sort((left, right) => left - right);

  return {
    name: `${source}/${name}`,
    source,
    samples,
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    ...classification,
  };
}
