export const DEFAULT_ESCAPE_COMMENT_PATTERN = "drizzle-scoped-db-escape-ok:";

export const ESCAPE_HATCH_NAMES = ["_raw", "_unsafeUnscopedDb", "$unsafeUnscoped"] as const;
export const ESCAPE_HELPER_NAMES = ["extractRawDb"] as const;

export type EscapeHatchName =
  | (typeof ESCAPE_HATCH_NAMES)[number]
  | (typeof ESCAPE_HELPER_NAMES)[number];

export type EscapeFinding = {
  filePath: string;
  line: number;
  column: number;
  name: EscapeHatchName;
  kind: "member" | "helper";
  message: string;
};

export type ScanEscapesOptions = {
  filePath?: string;
  allowWithComment?: boolean;
  commentPattern?: string;
};

type CommentRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  text: string;
};

type RawFinding = {
  index: number;
  name: EscapeHatchName;
  kind: "member" | "helper";
};

const memberNames = new Set<string>(ESCAPE_HATCH_NAMES);
const helperNames = new Set<string>(ESCAPE_HELPER_NAMES);

/** Scan JS/TS source for scoped DB escape hatches. */
export function scanSourceForEscapes(
  source: string,
  options: ScanEscapesOptions = {},
): EscapeFinding[] {
  const filePath = options.filePath ?? "<input>";
  const lineStarts = getLineStarts(source);
  const scan = scanSource(source, lineStarts);
  const commentPattern = options.commentPattern ?? DEFAULT_ESCAPE_COMMENT_PATTERN;

  return scan.findings
    .filter(
      (finding) =>
        !options.allowWithComment ||
        !hasNearbyEscapeComment(scan.comments, finding.index, lineStarts, commentPattern),
    )
    .map((finding) => {
      const loc = getLocation(lineStarts, finding.index);
      return {
        filePath,
        line: loc.line,
        column: loc.column,
        name: finding.name,
        kind: finding.kind,
        message: escapeMessage(finding.name),
      };
    });
}

export function escapeMessage(name: EscapeHatchName): string {
  if (name === "$unsafeUnscoped") {
    return "Scoped insert escape hatch .$unsafeUnscoped() must be audited.";
  }
  if (name === "extractRawDb") {
    return "Raw scoped DB extraction via extractRawDb(...) must be audited.";
  }
  return `Scoped DB escape hatch .${name} must be audited.`;
}

export function commentMatchesPattern(commentText: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(commentText);
  } catch {
    return commentText.includes(pattern);
  }
}

function scanSource(source: string, lineStarts: readonly number[]) {
  const comments: CommentRange[] = [];
  const findings: RawFinding[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      comments.push(createCommentRange(source, start, index, lineStarts));
      continue;
    }

    if (char === "/" && next === "*") {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      comments.push(createCommentRange(source, start, index, lineStarts));
      continue;
    }

    if (char === '"' || char === "'") {
      index = skipQuotedString(source, index, char);
      continue;
    }

    if (char === "`") {
      index = skipTemplate(source, index);
      continue;
    }

    if (char === ".") {
      const propertyStart = index + 1;
      const propertyName = readIdentifier(source, propertyStart);
      if (memberNames.has(propertyName)) {
        findings.push({ index, name: propertyName as EscapeHatchName, kind: "member" });
      }
      index = propertyName ? propertyStart + propertyName.length : index + 1;
      continue;
    }

    if (isIdentifierStart(char)) {
      const identifier = readIdentifier(source, index);
      if (helperNames.has(identifier) && isCallAfterIdentifier(source, index + identifier.length)) {
        findings.push({ index, name: identifier as EscapeHatchName, kind: "helper" });
      }
      index += identifier.length;
      continue;
    }

    index += 1;
  }

  return { comments, findings };
}

function hasNearbyEscapeComment(
  comments: readonly CommentRange[],
  findingIndex: number,
  lineStarts: readonly number[],
  pattern: string,
): boolean {
  const findingLoc = getLocation(lineStarts, findingIndex);
  return comments.some((comment) => {
    if (!commentMatchesPattern(comment.text, pattern)) return false;
    const sameLineBeforeUse = comment.end <= findingIndex && comment.endLine === findingLoc.line;
    const previousLine = comment.end <= findingIndex && comment.endLine >= findingLoc.line - 2;
    return sameLineBeforeUse || previousLine;
  });
}

function createCommentRange(
  source: string,
  start: number,
  end: number,
  lineStarts: readonly number[],
): CommentRange {
  return {
    start,
    end,
    startLine: getLocation(lineStarts, start).line,
    endLine: getLocation(lineStarts, Math.max(start, end - 1)).line,
    text: source.slice(start, end),
  };
}

function skipQuotedString(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return index;
}

function skipTemplate(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "`") return index + 1;
    index += 1;
  }
  return index;
}

function isCallAfterIdentifier(source: string, start: number): boolean {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return source[index] === "(";
}

function readIdentifier(source: string, start: number): string {
  if (!isIdentifierStart(source[start])) return "";
  let index = start + 1;
  while (isIdentifierPart(source[index])) index += 1;
  return source.slice(start, index);
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[$_A-Za-z]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[$_A-Za-z0-9]/.test(char);
}

function getLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function getLocation(
  lineStarts: readonly number[],
  index: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;
    const nextLineStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (index < lineStart) {
      high = middle - 1;
    } else if (index >= nextLineStart) {
      low = middle + 1;
    } else {
      return { line: middle + 1, column: index - lineStart + 1 };
    }
  }
  return { line: 1, column: index + 1 };
}
