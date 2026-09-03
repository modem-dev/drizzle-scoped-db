#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateMetric } from "./lib/benchmark-result.mjs";
import {
  readPackageVersion,
  releaseBenchmarkDir,
  releaseBenchmarkPath,
} from "../scripts/compare-release-benchmarks.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const probeTsconfig = path.join(repoRoot, "benchmarks", "types", "tsconfig.json");

/** Snapshot file prefix shared with the comparison CLI (`types-x.y.z.json`). */
export const TYPE_BENCHMARK_PREFIX = "types";

const DIAGNOSTIC_PATTERN = /^(Types|Instantiations|Memory used|Check time):\s+([\d.]+)(K|s)?$/gm;

function readArgValue(args, index) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return value;
}

function readPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

async function parseArgs(args) {
  const version = await readPackageVersion(repoRoot);
  const options = {
    version,
    samples: readPositiveInteger(
      process.env.DRIZZLE_SCOPED_DB_TYPE_BENCHMARK_SAMPLES ?? "3",
      "DRIZZLE_SCOPED_DB_TYPE_BENCHMARK_SAMPLES",
    ),
    out: releaseBenchmarkPath(version, releaseBenchmarkDir(repoRoot), TYPE_BENCHMARK_PREFIX),
  };
  let outExplicitlySet = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--version") {
      options.version = readArgValue(args, index);
      if (!outExplicitlySet) {
        options.out = releaseBenchmarkPath(
          options.version,
          releaseBenchmarkDir(repoRoot),
          TYPE_BENCHMARK_PREFIX,
        );
      }
      index += 1;
      continue;
    }

    if (arg === "--samples") {
      options.samples = readPositiveInteger(readArgValue(args, index), "--samples");
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = path.resolve(readArgValue(args, index));
      outExplicitlySet = true;
      index += 1;
      continue;
    }

    throw new Error(`Unknown type benchmark argument: ${arg}`);
  }

  return options;
}

function gitSha() {
  const proc = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return proc.status === 0 ? proc.stdout.trim() : undefined;
}

function dependencyVersion(name) {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "node_modules", name, "package.json"), "utf8"),
  );
  return packageJson.version;
}

/** Parse the `tsc --extendedDiagnostics` counters this benchmark tracks into plain numbers. */
export function parseDiagnostics(output) {
  const diagnostics = {};
  for (const match of output.matchAll(DIAGNOSTIC_PATTERN)) {
    const [, label, rawValue, unit] = match;
    const value = Number(rawValue);
    if (label === "Memory used") {
      diagnostics.memoryUsedBytes = unit === "K" ? value * 1024 : value;
    } else if (label === "Check time") {
      diagnostics.checkTimeMs = unit === "s" ? value * 1000 : value;
    } else if (label === "Types") {
      diagnostics.typeCount = value;
    } else if (label === "Instantiations") {
      diagnostics.instantiationCount = value;
    }
  }

  for (const key of ["typeCount", "instantiationCount", "checkTimeMs", "memoryUsedBytes"]) {
    if (typeof diagnostics[key] !== "number" || Number.isNaN(diagnostics[key])) {
      throw new Error(`tsc --extendedDiagnostics output did not include ${key}:\n${output}`);
    }
  }

  return diagnostics;
}

function runTypeCheckSample() {
  const proc = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "-p",
      probeTsconfig,
      "--noEmit",
      "--incremental",
      "false",
      "--extendedDiagnostics",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;

  if (proc.status !== 0) {
    throw new Error(`Type benchmark probe failed to type-check:\n${output}`);
  }

  return parseDiagnostics(output);
}

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Type-check the fixed consumer probe repeatedly and aggregate the tsc counters. */
export function runTypeBenchmark(samples) {
  const samplesByMetric = new Map([
    ["type_count", []],
    ["instantiation_count", []],
    ["check_time_ms", []],
    ["memory_used_bytes", []],
  ]);

  for (let sample = 1; sample <= samples; sample += 1) {
    const diagnostics = runTypeCheckSample();
    samplesByMetric.get("type_count").push(diagnostics.typeCount);
    samplesByMetric.get("instantiation_count").push(diagnostics.instantiationCount);
    samplesByMetric.get("check_time_ms").push(diagnostics.checkTimeMs);
    samplesByMetric.get("memory_used_bytes").push(diagnostics.memoryUsedBytes);
    console.log(
      `types sample ${sample}/${samples}: types=${diagnostics.typeCount} instantiations=${diagnostics.instantiationCount} check=${formatValue(diagnostics.checkTimeMs)}ms`,
    );
  }

  return [...samplesByMetric.entries()]
    .map(([metric, values]) => {
      const result = aggregateMetric("types", metric, values);
      // Wall-clock and memory vary by machine; only the deterministic tsc counters gate releases.
      if (metric === "check_time_ms") {
        return { ...result, comparable: false, threshold: undefined };
      }
      return result;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Run the type-check benchmark and write the versioned snapshot. */
export async function main(args = process.argv.slice(2)) {
  const options = await parseArgs(args);
  mkdirSync(path.dirname(options.out), { recursive: true });

  console.log(`Running type-check benchmarks for ${options.version}`);
  console.log(`Samples: ${options.samples}`);

  const results = runTypeBenchmark(options.samples);
  const runResult = {
    version: 1,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    packageVersion: options.version,
    runtime: {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      typescriptVersion: dependencyVersion("typescript"),
      drizzleOrmVersion: dependencyVersion("drizzle-orm"),
    },
    benchmarkConfig: {
      probe: "benchmarks/types/consumer.ts",
    },
    samplesPerBenchmark: options.samples,
    results,
  };

  console.log("\n## Aggregated type-check medians");
  for (const result of results) {
    console.log(`${result.name}: median=${formatValue(result.median)} ${result.unit}`);
  }

  writeFileSync(options.out, `${JSON.stringify(runResult, null, 2)}\n`);
  console.log(`\nWrote type-check benchmark ${options.out}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
