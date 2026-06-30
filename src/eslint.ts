import {
  DEFAULT_ESCAPE_COMMENT_PATTERN,
  ESCAPE_HATCH_NAMES,
  commentMatchesPattern,
  escapeMessage,
  type EscapeHatchName,
} from "./lint-escapes.js";

export type EscapeAuditRuleOptions = {
  allowWithComment?: boolean;
  commentPattern?: string;
  allowedFiles?: string[];
};

type SourceCode = {
  getAllComments(): AstNode[];
};

type RuleContext = {
  id?: string;
  options?: EscapeAuditRuleOptions[];
  filename?: string;
  sourceCode?: SourceCode;
  getFilename?: () => string;
  getSourceCode?: () => SourceCode;
  report(descriptor: { node: AstNode; message: string }): void;
};

type AstNode = {
  type?: string;
  name?: string;
  value?: unknown;
  property?: AstNode;
  callee?: AstNode;
  computed?: boolean;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  range?: [number, number];
};

type RuleModule = {
  meta: {
    type: "problem";
    docs: { description: string; recommended?: boolean };
    schema: unknown[];
    messages?: Record<string, string>;
  };
  create(context: RuleContext): Record<string, (node: AstNode) => void>;
};

type ConfigName = "recommended" | "strict" | "no-escapes";

type EslintFlatConfig = {
  plugins: Record<string, EslintPlugin>;
  rules: Record<string, unknown>;
};

type EslintPlugin = {
  rules: Record<"no-unsafe-escape" | "require-unsafe-escape-reason", RuleModule>;
  configs: Record<ConfigName, EslintFlatConfig>;
};

const optionSchema = [
  {
    type: "object",
    additionalProperties: false,
    properties: {
      allowWithComment: { type: "boolean" },
      commentPattern: { type: "string" },
      allowedFiles: { type: "array", items: { type: "string" } },
    },
  },
];

const escapeNames = new Set<string>(ESCAPE_HATCH_NAMES);

const noUnsafeEscape: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Report uses of drizzle-scoped-db raw/unsafe escape hatches.",
      recommended: true,
    },
    schema: optionSchema,
  },
  create(context) {
    return createEscapeVisitors(context, { requireCommentOnly: false });
  },
};

const requireUnsafeEscapeReason: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby audit comment for drizzle-scoped-db raw/unsafe escape hatches.",
      recommended: true,
    },
    schema: optionSchema,
  },
  create(context) {
    return createEscapeVisitors(context, { requireCommentOnly: true });
  },
};

function createEscapeVisitors(
  context: RuleContext,
  mode: { requireCommentOnly: boolean },
): Record<string, (node: AstNode) => void> {
  const options = context.options?.[0] ?? {};
  const commentPattern = options.commentPattern ?? DEFAULT_ESCAPE_COMMENT_PATTERN;
  const filename = context.filename ?? context.getFilename?.() ?? "<input>";

  function report(node: AstNode, name: EscapeHatchName) {
    if (isAllowedFile(filename, options.allowedFiles)) return;

    const hasComment = hasNearbyEscapeComment(context, node, commentPattern);
    if (mode.requireCommentOnly && hasComment) return;
    if (!mode.requireCommentOnly && options.allowWithComment && hasComment) return;

    const suffix = mode.requireCommentOnly
      ? ` Add a nearby comment matching ${JSON.stringify(commentPattern)}.`
      : "";
    context.report({ node, message: `${escapeMessage(name)}${suffix}` });
  }

  return {
    MemberExpression(node) {
      const name = getMemberPropertyName(node);
      if (name && escapeNames.has(name)) {
        report(node, name as EscapeHatchName);
      }
    },
    CallExpression(node) {
      if (node.callee?.type === "Identifier" && node.callee.name === "extractRawDb") {
        report(node, "extractRawDb");
      }
    },
  };
}

function getMemberPropertyName(node: AstNode): string | undefined {
  const property = node.property;
  if (!property) return undefined;
  if (!node.computed && property.type === "Identifier") return property.name;
  if (node.computed && typeof property.value === "string") return property.value;
  return undefined;
}

function hasNearbyEscapeComment(context: RuleContext, node: AstNode, pattern: string): boolean {
  const sourceCode = context.sourceCode ?? context.getSourceCode?.();
  const nodeLine = node.loc?.start.line;
  const nodeStart = node.range?.[0];
  if (!sourceCode || nodeLine === undefined) return false;

  return sourceCode.getAllComments().some((comment) => {
    if (!comment.loc || !comment.range) return false;
    if (!commentMatchesPattern(String(comment.value ?? ""), pattern)) return false;

    const endsBeforeNode = nodeStart === undefined || comment.range[1] <= nodeStart;
    if (!endsBeforeNode) return false;

    const sameLineBeforeUse = comment.loc.end.line === nodeLine;
    const previousLine = comment.loc.end.line >= nodeLine - 2;
    return sameLineBeforeUse || previousLine;
  });
}

function isAllowedFile(filename: string, allowedFiles: readonly string[] | undefined): boolean {
  return allowedFiles?.some((pattern) => wildcardMatch(filename, pattern)) ?? false;
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

const plugin: EslintPlugin = {
  rules: {
    "no-unsafe-escape": noUnsafeEscape,
    "require-unsafe-escape-reason": requireUnsafeEscapeReason,
  },
  configs: {} as Record<ConfigName, EslintFlatConfig>,
};

plugin.configs = {
  recommended: {
    plugins: { "drizzle-scoped-db": plugin },
    rules: {
      "drizzle-scoped-db/require-unsafe-escape-reason": "warn",
    },
  },
  strict: {
    plugins: { "drizzle-scoped-db": plugin },
    rules: {
      "drizzle-scoped-db/require-unsafe-escape-reason": "error",
    },
  },
  "no-escapes": {
    plugins: { "drizzle-scoped-db": plugin },
    rules: {
      "drizzle-scoped-db/no-unsafe-escape": "error",
    },
  },
};

export const rules = plugin.rules;
export const configs = plugin.configs;
export default plugin;
