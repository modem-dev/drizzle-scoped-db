import { getTableName, type SQL, type Table } from "drizzle-orm";

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

  const expectedTableKey = table ? getTableKey(table) : undefined;
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

/** Alias-safe identity check: matches the column's actual query table name, including aliases. */
function isColumnOnTable(chunk: object, expectedTableKey?: string): boolean {
  if (!expectedTableKey) {
    return true;
  }
  const chunkTable = (chunk as { table?: Table | undefined }).table;
  return chunkTable !== undefined && getTableKey(chunkTable) === expectedTableKey;
}

/** Resolve the table key Drizzle will use in this query (alias name for aliases). */
function getTableKey(table: Table): string {
  return getTableName(table);
}
