import { type Column, eq } from "drizzle-orm";

import { containsColumnFilter } from "./drizzle-compat.js";
import { createRqbV2ColumnObjectFilter } from "./internal/relational/rqb-v2-object-filter.js";
import type { ScopedTable, ScopedTableRule, ScopeByColumnOptions } from "./types.js";

/** Create a scoping rule for the common case where one table column stores the scope value. */
export function scopeByColumn<TScope, TTable extends ScopedTable>(
  table: TTable,
  column: Column,
  options: ScopeByColumnOptions<TScope> = {},
): ScopedTableRule<TScope, TTable> {
  const columnName = options.columnName ?? getColumnName(column);
  const equals = options.equals ?? Object.is;
  const updateKey = options.updateKey ?? options.insertKey;

  return {
    table,
    queryName: options.queryName,
    tableName: options.tableName,
    where: (scopeValue) => eq(column as Parameters<typeof eq>[0], scopeValue),
    validateInsert: options.insertKey
      ? (row, scopeValue) =>
          equals((row as Record<string, unknown>)[options.insertKey as string], scopeValue)
      : undefined,
    validateUpdate: updateKey
      ? (payload, scopeValue) => {
          if (!(updateKey in (payload as Record<string, unknown>))) {
            return true;
          }
          return equals((payload as Record<string, unknown>)[updateKey], scopeValue);
        }
      : undefined,
    hasScopeInConflictTarget: (target) => conflictTargetContainsColumn(target, column, columnName),
    hasScopeInWhere: (condition) => containsColumnFilter(condition, columnName, table),
    relational: {
      rqbV2: createRqbV2ColumnObjectFilter(table, column, columnName),
    },
  };
}

/** Create a custom scoping rule for predicates that cannot be represented by a single column. */
export function defineScopedTable<
  TScope,
  TTable extends ScopedTable,
  TInsert = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
>(
  table: TTable,
  rule: Omit<ScopedTableRule<TScope, TTable, TInsert, TUpdate>, "table">,
): ScopedTableRule<TScope, TTable, TInsert, TUpdate> {
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

/** Checks whether a Drizzle conflict target includes the column that carries scope. */
function conflictTargetContainsColumn(
  target: unknown,
  column: Column,
  columnName: string,
): boolean {
  const targets = Array.isArray(target) ? target : [target];
  return targets.some((candidate) => candidate === column || hasColumnName(candidate, columnName));
}

function hasColumnName(candidate: unknown, columnName: string): boolean {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "name" in candidate &&
    (candidate as { name?: unknown }).name === columnName
  );
}
