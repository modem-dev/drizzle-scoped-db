import { type Column, eq } from "drizzle-orm";

import { containsColumnFilter } from "./drizzle-compat.js";
import type { ScopedTable, ScopedTableRule, ScopeByColumnOptions } from "./types.js";

/** Create a scoping rule for the common case where one table column stores the scope value. */
export function scopeByColumn<TScope, TTable extends ScopedTable>(
  table: TTable,
  column: Column,
  options: ScopeByColumnOptions<TScope> = {},
): ScopedTableRule<TScope, TTable> {
  const columnName = options.columnName ?? getColumnName(column);
  const equals = options.equals ?? Object.is;

  return {
    table,
    queryName: options.queryName,
    tableName: options.tableName,
    where: (scopeValue) => eq(column as Parameters<typeof eq>[0], scopeValue),
    validateInsert: options.insertKey
      ? (row, scopeValue) =>
          equals((row as Record<string, unknown>)[options.insertKey as string], scopeValue)
      : undefined,
    hasScopeInWhere: (condition) => containsColumnFilter(condition, columnName),
  };
}

/** Create a custom scoping rule for predicates that cannot be represented by a single column. */
export function defineScopedTable<
  TScope,
  TTable extends ScopedTable,
  TInsert = Record<string, unknown>,
>(
  table: TTable,
  rule: Omit<ScopedTableRule<TScope, TTable, TInsert>, "table">,
): ScopedTableRule<TScope, TTable, TInsert> {
  return { table, ...rule };
}

/** Extract Drizzle's SQL column name from a column object. */
function getColumnName(column: Column): string {
  const columnWithName = column as { name?: unknown };
  if (typeof columnWithName.name !== "string") {
    throw new Error("Unable to infer Drizzle column name. Pass `columnName` to scopeByColumn().");
  }
  return columnWithName.name;
}
