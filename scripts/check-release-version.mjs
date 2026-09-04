#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageVersion } from "./compare-release-benchmarks.mjs";

function normalizeTag(tag) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export async function main(args = process.argv.slice(2)) {
  const tag = args[0];
  if (!tag) {
    throw new Error("Usage: node scripts/check-release-version.mjs <tag>");
  }

  const packageVersion = await readPackageVersion();
  const tagVersion = normalizeTag(tag);
  if (tagVersion !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match package.json version ${packageVersion}.`);
  }

  const benchmarkPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "benchmarks",
    "release",
    `bench-${packageVersion}.json`,
  );
  if (!existsSync(benchmarkPath)) {
    throw new Error(
      `Missing release benchmark ${benchmarkPath}. Run pnpm bench:release and commit the snapshot before pushing the tag.`,
    );
  }

  console.log(`Release tag ${tag} matches package.json version ${packageVersion}.`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
