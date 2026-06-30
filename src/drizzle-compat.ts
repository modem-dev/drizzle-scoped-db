import { type SQL, type Table } from "drizzle-orm";

/** Drizzle stores the underlying table name here even when a query aliases the table (e.g. the
 *  relational query API aliases columns to the table's TS name). */
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

/** Alias-safe identity check: matches when the column belongs to the expected scoped table, even
 *  when the query references it through an alias (as Drizzle's relational query API does). */
function isColumnOnTable(chunk: object, expectedTableKey?: string): boolean {
  if (!expectedTableKey) {
    return true;
  }
  const chunkTable = (chunk as { table?: Table | undefined }).table;
  return chunkTable !== undefined && getTableKey(chunkTable) === expectedTableKey;
}

/** Resolve a stable identity key for a table, collapsing aliases back to the underlying table.
 *  Drizzle's relational query API (`db.query.*.findMany({ where: (t, ...) => ... })`) hands the
 *  callback columns whose table is aliased to the schema's TS name (e.g. `groupsTbl`), while the
 *  rule's table reports its SQL name (e.g. `groups`). Both a plain table and an alias expose the
 *  underlying name via the `OriginalName` symbol (Drizzle's Table constructor sets it to the SQL
 *  name; its alias proxy preserves it), so keying on it lets aliased references match their scoped
 *  rule while still distinguishing genuinely different tables. */
function getTableKey(table: Table): string | undefined {
  return (table as object as Record<symbol, string>)[ORIGINAL_TABLE_NAME];
}
