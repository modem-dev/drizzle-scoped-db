#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { and, eq, or } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { aggregateMetric } from "./lib/benchmark-result.mjs";
import {
  readPackageVersion,
  releaseBenchmarkDir,
  releaseBenchmarkPath,
} from "../scripts/compare-release-benchmarks.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const projectsTbl = pgTable("benchmark_projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
});

const tasksTbl = pgTable("benchmark_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
});

const relationalOperators = { and, eq, or };

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
      process.env.DRIZZLE_SCOPED_DB_RELEASE_BENCHMARK_SAMPLES ?? "5",
      "DRIZZLE_SCOPED_DB_RELEASE_BENCHMARK_SAMPLES",
    ),
    createIterations: readPositiveInteger(
      process.env.DRIZZLE_SCOPED_DB_CREATE_ITERATIONS ?? "100000",
      "DRIZZLE_SCOPED_DB_CREATE_ITERATIONS",
    ),
    selectIterations: readPositiveInteger(
      process.env.DRIZZLE_SCOPED_DB_SELECT_ITERATIONS ?? "50000",
      "DRIZZLE_SCOPED_DB_SELECT_ITERATIONS",
    ),
    relationalIterations: readPositiveInteger(
      process.env.DRIZZLE_SCOPED_DB_RELATIONAL_ITERATIONS ?? "20000",
      "DRIZZLE_SCOPED_DB_RELATIONAL_ITERATIONS",
    ),
    memoryIterations: readPositiveInteger(
      process.env.DRIZZLE_SCOPED_DB_MEMORY_ITERATIONS ?? "25000",
      "DRIZZLE_SCOPED_DB_MEMORY_ITERATIONS",
    ),
    out: releaseBenchmarkPath(version, releaseBenchmarkDir(repoRoot)),
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
        options.out = releaseBenchmarkPath(options.version, releaseBenchmarkDir(repoRoot));
      }
      index += 1;
      continue;
    }

    if (arg === "--samples") {
      options.samples = readPositiveInteger(readArgValue(args, index), "--samples");
      index += 1;
      continue;
    }

    if (arg === "--create-iterations") {
      options.createIterations = readPositiveInteger(
        readArgValue(args, index),
        "--create-iterations",
      );
      index += 1;
      continue;
    }

    if (arg === "--select-iterations") {
      options.selectIterations = readPositiveInteger(
        readArgValue(args, index),
        "--select-iterations",
      );
      index += 1;
      continue;
    }

    if (arg === "--relational-iterations") {
      options.relationalIterations = readPositiveInteger(
        readArgValue(args, index),
        "--relational-iterations",
      );
      index += 1;
      continue;
    }

    if (arg === "--memory-iterations") {
      options.memoryIterations = readPositiveInteger(
        readArgValue(args, index),
        "--memory-iterations",
      );
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = path.resolve(readArgValue(args, index));
      outExplicitlySet = true;
      index += 1;
      continue;
    }

    throw new Error(`Unknown release benchmark argument: ${arg}`);
  }

  return options;
}

function createFakeDb(state = {}) {
  const db = {
    query: {
      projects: {
        async findFirst(config) {
          state.relationalCondition = resolveRelationalWhere(config?.where);
          return { condition: state.relationalCondition };
        },
        async findMany(config) {
          state.relationalCondition = resolveRelationalWhere(config?.where);
          return [{ condition: state.relationalCondition }];
        },
      },
    },
    select() {
      return createSelectBuilder(state);
    },
    selectDistinct() {
      return createSelectBuilder(state);
    },
    selectDistinctOn() {
      return createSelectBuilder(state);
    },
    insert() {
      return {
        values(values) {
          state.insertValues = values;
          return { values };
        },
      };
    },
    update() {
      return {
        set(values) {
          return {
            where(condition) {
              state.updateCondition = condition;
              return { condition, values };
            },
          };
        },
      };
    },
    delete() {
      return {
        where(condition) {
          state.deleteCondition = condition;
          return { condition };
        },
      };
    },
    async transaction(callback) {
      const tx = createFakeDb(state);
      state.transactionRawDb = tx;
      return callback(tx);
    },
    execute() {
      return undefined;
    },
    _state: state,
  };

  return db;
}

function resolveRelationalWhere(where) {
  return typeof where === "function" ? where(projectsTbl, relationalOperators) : where;
}

function createSelectBuilder(state) {
  return {
    from() {
      return createFromBuilder(state);
    },
  };
}

function createFromBuilder(state) {
  const builder = {
    where(condition) {
      state.selectCondition = condition;
      return {
        condition,
        limit() {
          return this;
        },
        offset() {
          return this;
        },
        orderBy() {
          return this;
        },
      };
    },
    leftJoin(_table, on) {
      state.joinCondition = on;
      return builder;
    },
    innerJoin(_table, on) {
      state.joinCondition = on;
      return builder;
    },
  };

  return builder;
}

function gitSha() {
  const proc = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return proc.status === 0 ? proc.stdout.trim() : undefined;
}

function createBenchmarkContext(library) {
  const rules = [
    library.scopeByColumn(projectsTbl, projectsTbl.workspaceId, {
      queryName: "projects",
      insertKey: "workspaceId",
    }),
    library.scopeByColumn(tasksTbl, tasksTbl.workspaceId, { insertKey: "workspaceId" }),
  ];
  const options = {
    scopeName: "workspace",
    scopeValue: "workspace-1",
    strict: false,
    rules,
  };
  const rawDb = createFakeDb();

  return { rawDb, options, rules };
}

async function collectMetric(samplesByMetric, source, metric, samples, callback) {
  const values = [];

  for (let sample = 1; sample <= samples; sample += 1) {
    const startedAt = performance.now();
    const value = await callback();
    const elapsed = performance.now() - startedAt;
    values.push(value ?? elapsed);
    console.log(
      `${source}/${metric} sample ${sample}/${samples}: ${formatValue(value ?? elapsed)}`,
    );
  }

  samplesByMetric.set(`${source}/${metric}`, { source, metric, samples: values });
}

function forceGc() {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Release memory benchmarks require node --expose-gc.");
  }

  for (let index = 0; index < 3; index += 1) {
    globalThis.gc();
  }
}

function formatValue(value) {
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

async function runBenchmarkSuite(library, options) {
  const context = createBenchmarkContext(library);
  const samplesByMetric = new Map();

  await collectMetric(samplesByMetric, "wrapper", "create_scoped_db_ms", options.samples, () => {
    for (let index = 0; index < options.createIterations; index += 1) {
      library.createScopedDb(context.rawDb, context.options);
    }
  });

  const scopedDb = library.createScopedDb(context.rawDb, context.options);
  await collectMetric(samplesByMetric, "select", "scoped_select_ms", options.samples, () => {
    for (let index = 0; index < options.selectIterations; index += 1) {
      scopedDb
        .select()
        .from(projectsTbl)
        .leftJoin(tasksTbl, eq(tasksTbl.projectId, projectsTbl.id))
        .where(eq(projectsTbl.id, "project-1"))
        .limit(10);
    }
  });

  await collectMetric(samplesByMetric, "relational", "find_many_ms", options.samples, async () => {
    for (let index = 0; index < options.relationalIterations; index += 1) {
      await scopedDb.query.projects.findMany({
        where: (project, operators) => operators.eq(project.id, "project-1"),
      });
    }
  });

  await collectMetric(samplesByMetric, "memory", "heap_growth_bytes", options.samples, () => {
    forceGc();
    const before = process.memoryUsage().heapUsed;
    for (let index = 0; index < options.memoryIterations; index += 1) {
      const transientDb = library.createScopedDb(context.rawDb, context.options);
      transientDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1"));
    }
    forceGc();
    return Math.max(0, process.memoryUsage().heapUsed - before);
  });

  return [...samplesByMetric.values()]
    .map(({ source, metric, samples }) => aggregateMetric(source, metric, samples))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadLibrary() {
  try {
    return await import("../dist/index.js");
  } catch (error) {
    throw new Error("Unable to load dist/index.js. Run pnpm build before release benchmarks.", {
      cause: error,
    });
  }
}

/** Run the default release benchmark suite and write the versioned release snapshot. */
export async function main(args = process.argv.slice(2)) {
  const options = await parseArgs(args);
  const library = await loadLibrary();
  mkdirSync(path.dirname(options.out), { recursive: true });

  console.log(`Running release benchmarks for ${options.version}`);
  console.log(`Samples: ${options.samples}`);

  const results = await runBenchmarkSuite(library, options);
  const runResult = {
    version: 1,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    packageVersion: options.version,
    runtime: {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
    },
    benchmarkConfig: {
      createIterations: options.createIterations,
      selectIterations: options.selectIterations,
      relationalIterations: options.relationalIterations,
      memoryIterations: options.memoryIterations,
    },
    samplesPerBenchmark: options.samples,
    results,
  };

  console.log("\n## Aggregated benchmark medians");
  for (const result of results) {
    const suffix = result.unit === "ms" ? "ms" : result.unit === "bytes" ? " bytes" : "";
    console.log(
      `${result.name}: median=${formatValue(result.median)}${suffix} p95=${formatValue(result.p95)}${suffix}`,
    );
  }

  writeFileSync(options.out, `${JSON.stringify(runResult, null, 2)}\n`);
  console.log(`\nWrote release benchmark ${options.out}`);
  console.log("Commit this file with the release prep change before pushing the release tag.");
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
