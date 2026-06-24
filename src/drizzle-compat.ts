import type { SQL } from "drizzle-orm";

/** Checks whether a Drizzle SQL condition references the given SQL column name. */
export function containsColumnFilter(condition: SQL | undefined, columnName: string): boolean {
  if (!condition) {
    return false;
  }

  const sqlWithChunks = condition as { queryChunks?: unknown[] };
  if (!Array.isArray(sqlWithChunks.queryChunks)) {
    return false;
  }

  return searchForColumnInChunks(sqlWithChunks.queryChunks, columnName);
}

/** Assert that Drizzle SQL chunks are still inspectable by strict scope-in-where validation. */
export function assertDrizzleCompatibility(condition: SQL, expectedColumnName: string): void {
  const sqlWithChunks = condition as { queryChunks?: unknown[] };
  if (
    !Array.isArray(sqlWithChunks.queryChunks) ||
    !containsColumnFilter(condition, expectedColumnName)
  ) {
    throw new Error(
      `Drizzle SQL compatibility check failed: expected condition chunks to expose column "${expectedColumnName}". ` +
        "Update strict scope-in-where validation for this Drizzle version.",
    );
  }
}

/** Recursively search Drizzle SQL query chunks for a column reference. */
function searchForColumnInChunks(chunks: unknown[], columnName: string): boolean {
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }

    if (typeof chunk === "object") {
      if ("name" in chunk && chunk.name === columnName) {
        return true;
      }

      if ("queryChunks" in chunk && Array.isArray(chunk.queryChunks)) {
        if (searchForColumnInChunks(chunk.queryChunks, columnName)) {
          return true;
        }
      }
    }
  }

  return false;
}
