import type { SQL, Table } from "drizzle-orm";

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

  return searchForColumnInChunks(sqlWithChunks.queryChunks, columnName, table);
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
function searchForColumnInChunks(chunks: unknown[], columnName: string, table?: Table): boolean {
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }

    if (typeof chunk === "object") {
      if ("name" in chunk && chunk.name === columnName && isColumnOnTable(chunk, table)) {
        return true;
      }

      if ("queryChunks" in chunk && Array.isArray(chunk.queryChunks)) {
        if (searchForColumnInChunks(chunk.queryChunks, columnName, table)) {
          return true;
        }
      }
    }
  }

  return false;
}

/** Reference-equality check that a column chunk belongs to the expected table. */
function isColumnOnTable(chunk: object, table?: Table): boolean {
  if (!table) {
    return true;
  }
  const chunkTable = (chunk as { table?: unknown }).table;
  return chunkTable === table;
}
