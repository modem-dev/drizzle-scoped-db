import type { SQL, Table } from "drizzle-orm";

/** Drizzle symbol storing the original (pre-alias) table name. */
const ORIGINAL_TABLE_NAME = Symbol.for("drizzle:OriginalName");

/** Checks whether a Drizzle SQL condition references the given column on the given table. */
export function containsColumnFilter(
  condition: SQL | undefined,
  columnName: string,
  table?: Table,
): boolean {
  if (!condition) {
    return false;
  }

  const sqlWithChunks = condition as { queryChunks?: unknown[] };
  if (!Array.isArray(sqlWithChunks.queryChunks)) {
    return false;
  }

  const expectedTableKey = table ? getOriginalTableName(table) : undefined;
  return searchForColumnInChunks(sqlWithChunks.queryChunks, columnName, expectedTableKey);
}

/** Assert that Drizzle SQL chunks are still inspectable by strict scope-in-where validation. */
export function assertDrizzleCompatibility(
  condition: SQL,
  expectedColumnName: string,
  expectedTable?: Table,
): void {
  const sqlWithChunks = condition as { queryChunks?: unknown[] };
  if (
    !Array.isArray(sqlWithChunks.queryChunks) ||
    !containsColumnFilter(condition, expectedColumnName, expectedTable)
  ) {
    throw new Error(
      `Drizzle SQL compatibility check failed: expected condition chunks to expose column "${expectedColumnName}". ` +
        "Update strict scope-in-where validation for this Drizzle version.",
    );
  }
}

/** Recursively search Drizzle SQL query chunks for a column reference on the expected table. */
function searchForColumnInChunks(
  chunks: unknown[],
  columnName: string,
  expectedTableKey?: string,
): boolean {
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }

    if (typeof chunk === "object") {
      if (
        "name" in chunk &&
        chunk.name === columnName &&
        isColumnOnTable(chunk, expectedTableKey)
      ) {
        return true;
      }

      if ("queryChunks" in chunk && Array.isArray(chunk.queryChunks)) {
        if (searchForColumnInChunks(chunk.queryChunks, columnName, expectedTableKey)) {
          return true;
        }
      }
    }
  }

  return false;
}

/** Alias-safe identity check: matches the column's table by original name, not reference. */
function isColumnOnTable(chunk: object, expectedTableKey?: string): boolean {
  if (!expectedTableKey) {
    return true;
  }
  const chunkTable = (chunk as { table?: Table | undefined }).table;
  return chunkTable !== undefined && getOriginalTableName(chunkTable) === expectedTableKey;
}

/** Resolve the stable pre-alias table name from Drizzle's OriginalName symbol. */
function getOriginalTableName(table: Table): string {
  return (table as unknown as Record<symbol, unknown>)[ORIGINAL_TABLE_NAME] as string;
}
