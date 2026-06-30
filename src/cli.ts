#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ESCAPE_COMMENT_PATTERN,
  scanSourceForEscapes,
  type EscapeFinding,
} from "./lint-escapes.js";

type CliOptions = {
  paths: string[];
  allowWithComment: boolean;
  commentPattern: string;
  format: "text" | "json";
  extensions: Set<string>;
};

const defaultExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules"]);

function main(argv: string[]): number {
  const invokedAsLintEscapes = path.basename(argv[1] ?? "").includes("lint-escapes");
  const args = invokedAsLintEscapes ? ["lint-escapes", ...argv.slice(2)] : argv.slice(2);
  const command = args[0];

  if (command === "--help" || command === "-h") {
    printTopLevelHelp();
    return 0;
  }

  if (command !== "lint-escapes") {
    printTopLevelHelp();
    return 2;
  }

  const parsed = parseLintEscapesArgs(args.slice(1));
  if (parsed === "help") {
    printLintEscapesHelp();
    return 0;
  }

  const files = collectFiles(parsed.paths, parsed.extensions);
  const findings = files.flatMap((filePath) =>
    scanSourceForEscapes(readFileSync(filePath, "utf8"), {
      filePath,
      allowWithComment: parsed.allowWithComment,
      commentPattern: parsed.commentPattern,
    }),
  );

  if (parsed.format === "json") {
    console.log(JSON.stringify({ findings }, undefined, 2));
  } else {
    printTextFindings(findings, parsed);
  }

  return findings.length > 0 ? 1 : 0;
}

function parseLintEscapesArgs(args: string[]): CliOptions | "help" {
  const options: CliOptions = {
    paths: [],
    allowWithComment: false,
    commentPattern: DEFAULT_ESCAPE_COMMENT_PATTERN,
    format: "text",
    extensions: defaultExtensions,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--allow-with-comment") {
      options.allowWithComment = true;
      continue;
    }
    if (arg === "--json") {
      options.format = "json";
      continue;
    }
    if (arg === "--comment-pattern") {
      const value = args[index + 1];
      if (!value) throw new Error("--comment-pattern requires a value");
      options.commentPattern = value;
      index += 1;
      continue;
    }
    if (arg === "--extensions") {
      const value = args[index + 1];
      if (!value) throw new Error("--extensions requires a comma-separated value");
      options.extensions = new Set(
        value
          .split(",")
          .map((extension) =>
            extension.startsWith(".") ? extension.trim() : `.${extension.trim()}`,
          ),
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    options.paths.push(arg);
  }

  if (options.paths.length === 0) options.paths.push("src");
  return options;
}

function collectFiles(inputs: readonly string[], extensions: ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!existsSync(resolved)) continue;
    collectPath(resolved, extensions, files);
  }
  return files.sort();
}

function collectPath(inputPath: string, extensions: ReadonlySet<string>, files: string[]): void {
  const stats = statSync(inputPath);
  if (stats.isDirectory()) {
    if (ignoredDirectories.has(path.basename(inputPath))) return;
    for (const entry of readdirSync(inputPath)) {
      collectPath(path.join(inputPath, entry), extensions, files);
    }
    return;
  }

  if (stats.isFile() && extensions.has(path.extname(inputPath))) {
    files.push(inputPath);
  }
}

function printTextFindings(findings: readonly EscapeFinding[], options: CliOptions): void {
  if (findings.length === 0) {
    console.log("No drizzle-scoped-db escape hatches found.");
    return;
  }

  for (const finding of findings) {
    console.log(
      `${finding.filePath}:${finding.line}:${finding.column} ${finding.message} (${finding.name})`,
    );
  }

  if (!options.allowWithComment) {
    console.log(
      `\nTo allow audited uses, rerun with --allow-with-comment and add a nearby comment matching ${JSON.stringify(
        options.commentPattern,
      )}.`,
    );
  }
}

function printTopLevelHelp(): void {
  console.log(`Usage: drizzle-scoped-db lint-escapes [paths...] [options]

Commands:
  lint-escapes  Scan JS/TS files for scoped DB escape hatches
`);
}

function printLintEscapesHelp(): void {
  console.log(`Usage: drizzle-scoped-db lint-escapes [paths...] [options]

Options:
  --allow-with-comment       Ignore uses with a nearby audit comment
  --comment-pattern <text>   Regex or text required in audit comments
                              default: ${DEFAULT_ESCAPE_COMMENT_PATTERN}
  --extensions <list>        Comma-separated extensions to scan
                              default: .ts,.tsx,.js,.jsx,.mjs,.cjs
  --json                     Print JSON findings
  -h, --help                 Show this help
`);
}

try {
  process.exitCode = main(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
