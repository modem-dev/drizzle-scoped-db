#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARK_FILE_PATTERN = /^bench-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.json$/;

/** Resolve the directory that stores committed release benchmark snapshots. */
export function releaseBenchmarkDir(root = repoRoot) {
  return path.join(root, "benchmarks", "release");
}

/** Parse the package version used by release benchmark filenames. */
export async function readPackageVersion(root = repoRoot) {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  return packageJson.version;
}

/** Parse the semver subset used by release tags and benchmark files. */
export function parseReleaseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    throw new Error(`Invalid release benchmark version: ${version}`);
  }

  return {
    raw: version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

/** Compare two release versions with stable releases ordered after their prereleases. */
export function compareReleaseVersions(left, right) {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);

  for (const key of ["major", "minor", "patch"]) {
    const delta = parsedLeft[key] - parsedRight[key];
    if (delta !== 0) {
      return delta;
    }
  }

  if (!parsedLeft.prerelease && !parsedRight.prerelease) {
    return 0;
  }

  if (!parsedLeft.prerelease) {
    return 1;
  }

  if (!parsedRight.prerelease) {
    return -1;
  }

  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Return the committed benchmark path for one package version. */
export function releaseBenchmarkPath(version, directory = releaseBenchmarkDir()) {
  parseReleaseVersion(version);
  return path.join(directory, `bench-${version}.json`);
}

/** Find the latest stable benchmark snapshot lower than the release candidate version. */
export function findPreviousReleaseBenchmark(version, directory = releaseBenchmarkDir()) {
  const current = parseReleaseVersion(version);
  if (!existsSync(directory)) {
    return undefined;
  }

  const candidates = readdirSync(directory)
    .map((fileName) => {
      const match = BENCHMARK_FILE_PATTERN.exec(fileName);
      if (!match) {
        return undefined;
      }

      const candidateVersion = parseReleaseVersion(match[1]);
      if (candidateVersion.prerelease) {
        return undefined;
      }

      if (compareReleaseVersions(candidateVersion.raw, current.raw) >= 0) {
        return undefined;
      }

      return {
        version: candidateVersion.raw,
        path: path.join(directory, fileName),
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareReleaseVersions(right.version, left.version));

  return candidates[0];
}

/** Read and lightly validate one benchmark JSON file. */
export async function loadBenchmarkRun(filePath) {
  const result = JSON.parse(await readFile(filePath, "utf8"));
  if (result.version !== 1 || !Array.isArray(result.results)) {
    throw new Error(`Invalid benchmark result file: ${filePath}`);
  }
  return result;
}

/** Determine whether a comparable metric exceeded its material-regression threshold. */
export function isMaterialRegression(baseMedian, headMedian, threshold) {
  const absoluteDelta = headMedian - baseMedian;
  if (absoluteDelta <= 0) {
    return false;
  }

  if (absoluteDelta < threshold.minAbsoluteRegression) {
    return false;
  }

  if (baseMedian === 0) {
    return headMedian > 0;
  }

  return headMedian / baseMedian >= threshold.maxRegressionRatio;
}

function relativeDelta(baseMedian, headMedian) {
  if (baseMedian === 0) {
    return headMedian === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return headMedian / baseMedian - 1;
}

function comparableThreshold(baseResult, headResult) {
  return headResult?.threshold ?? baseResult?.threshold;
}

/** Compare two benchmark snapshots and mark only material regressions as failures. */
export function compareBenchmarkRuns(base, head) {
  const baseByName = new Map(base.results.map((result) => [result.name, result]));
  const headByName = new Map(head.results.map((result) => [result.name, result]));
  const acceptedRegressionNames = new Set(
    (head.acceptedRegressions ?? []).map((entry) => entry.name),
  );
  const names = [...new Set([...baseByName.keys(), ...headByName.keys()])].sort();
  const rows = names.map((name) => {
    const baseResult = baseByName.get(name);
    const headResult = headByName.get(name);
    const resultForMetadata = headResult ?? baseResult;
    const threshold = comparableThreshold(baseResult, headResult);

    if (!baseResult && headResult) {
      return {
        name,
        unit: headResult.unit,
        baseMedian: 0,
        headMedian: headResult.median,
        absoluteDelta: headResult.median,
        relativeDelta: Number.POSITIVE_INFINITY,
        threshold,
        status: headResult.comparable ? "missing-base" : "informational",
        source: headResult.source,
      };
    }

    if (baseResult && !headResult) {
      return {
        name,
        unit: baseResult.unit,
        baseMedian: baseResult.median,
        headMedian: 0,
        absoluteDelta: -baseResult.median,
        relativeDelta: -1,
        threshold,
        status: baseResult.comparable ? "missing-head" : "informational",
        source: baseResult.source,
      };
    }

    const absoluteDelta = headResult.median - baseResult.median;
    const row = {
      name,
      unit: headResult.unit,
      baseMedian: baseResult.median,
      headMedian: headResult.median,
      absoluteDelta,
      relativeDelta: relativeDelta(baseResult.median, headResult.median),
      threshold,
      status: "informational",
      source: resultForMetadata.source,
    };

    if (!headResult.comparable || !threshold) {
      return row;
    }

    const materiallyRegressed = isMaterialRegression(
      baseResult.median,
      headResult.median,
      threshold,
    );
    return {
      ...row,
      status: materiallyRegressed
        ? acceptedRegressionNames.has(name)
          ? "accepted"
          : "fail"
        : "pass",
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseSha: base.gitSha,
    headSha: head.gitSha,
    failed: rows.some((row) => row.status === "fail" || row.status === "missing-head"),
    rows,
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "∞";
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function formatDeltaPercent(value) {
  if (!Number.isFinite(value)) {
    return "+∞";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatUnit(unit) {
  return unit === "bytes" ? "B" : unit;
}

function formatThresholdValue(value, unit) {
  if (unit === "bytes") {
    return `${formatNumber(value / (1024 * 1024))} MiB`;
  }

  if (unit === "ms") {
    return `${formatNumber(value)} ms`;
  }

  return `${formatNumber(value)} ${formatUnit(unit)}`;
}

function formatThreshold(threshold, unit) {
  if (!threshold) {
    return "—";
  }

  return `+${((threshold.maxRegressionRatio - 1) * 100).toFixed(0)}% and +${formatThresholdValue(
    threshold.minAbsoluteRegression,
    unit,
  )}`;
}

/** Render a compact Markdown report suitable for GitHub Actions summaries. */
export function formatComparisonMarkdown(comparison, options) {
  const failedRows = comparison.rows.filter(
    (row) => row.status === "fail" || row.status === "missing-head",
  );
  const lines = [
    "## Release benchmark gate",
    "",
    comparison.failed
      ? `❌ ${failedRows.length} material benchmark regression${failedRows.length === 1 ? "" : "s"} found.`
      : "✅ No unaccepted material benchmark regressions found.",
    "",
    `Base: \`${options.baseLabel}\`  `,
    `Head: \`${options.headLabel}\``,
    "",
  ];

  if (options.initialBaseline) {
    lines.push(
      "No previous release snapshot was found. This release establishes the initial baseline.",
      "",
    );
  }

  lines.push(
    "| Status | Metric | Base median | Head median | Δ | Threshold |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  );

  for (const row of comparison.rows) {
    const unit = formatUnit(row.unit);
    const status =
      row.status === "fail" || row.status === "missing-head"
        ? "❌"
        : row.status === "accepted"
          ? "⚠️"
          : "✅";
    lines.push(
      `| ${status} ${row.status} | \`${row.name}\` | ${formatNumber(row.baseMedian)} ${unit} | ${formatNumber(
        row.headMedian,
      )} ${unit} | ${formatDeltaPercent(row.relativeDelta)} | ${formatThreshold(row.threshold, row.unit)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function readArgValue(args, index) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return value;
}

async function parseArgs(args) {
  const packageVersion = await readPackageVersion();
  const options = {
    releaseDir: releaseBenchmarkDir(),
    version: packageVersion,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--release-dir") {
      options.releaseDir = path.resolve(readArgValue(args, index));
      index += 1;
      continue;
    }

    if (arg === "--version") {
      options.version = readArgValue(args, index);
      index += 1;
      continue;
    }

    if (arg === "--head") {
      options.head = path.resolve(readArgValue(args, index));
      index += 1;
      continue;
    }

    if (arg === "--base") {
      options.base = path.resolve(readArgValue(args, index));
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = path.resolve(readArgValue(args, index));
      index += 1;
      continue;
    }

    if (arg === "--summary") {
      options.summary = path.resolve(readArgValue(args, index));
      index += 1;
      continue;
    }

    throw new Error(`Unknown release benchmark comparison argument: ${arg}`);
  }

  parseReleaseVersion(options.version);
  return options;
}

/** Run the release benchmark comparison CLI. */
export async function main(args = process.argv.slice(2)) {
  const options = await parseArgs(args);
  const headPath = options.head ?? releaseBenchmarkPath(options.version, options.releaseDir);
  if (!existsSync(headPath)) {
    throw new Error(
      `Missing release benchmark ${headPath}. Run pnpm bench:release before tagging this release.`,
    );
  }

  const baseCandidate = options.base
    ? { version: path.basename(options.base), path: options.base }
    : findPreviousReleaseBenchmark(options.version, options.releaseDir);
  const head = await loadBenchmarkRun(headPath);
  const base = baseCandidate
    ? await loadBenchmarkRun(baseCandidate.path)
    : {
        version: 1,
        generatedAt: new Date(0).toISOString(),
        results: [],
        samplesPerBenchmark: 0,
      };
  const comparison = compareBenchmarkRuns(base, head);

  if (options.out) {
    mkdirSync(path.dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(comparison, null, 2)}\n`);
  }

  const markdown = formatComparisonMarkdown(comparison, {
    baseLabel: options.base ?? baseCandidate?.version ?? "none",
    headLabel: path.basename(headPath),
    initialBaseline: !baseCandidate,
  });
  process.stdout.write(markdown);

  if (options.summary) {
    appendFileSync(options.summary, `\n${markdown}`);
  }

  if (comparison.failed) {
    throw new Error(
      "Release benchmark gate failed. Resolve the regression or record an explicit accepted regression in the snapshot.",
    );
  }

  console.log(`Release benchmark gate passed on ${os.platform()}/${os.arch()}.`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
