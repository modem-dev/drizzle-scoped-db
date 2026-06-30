import { type Column, eq } from "drizzle-orm";

import { containsColumnFilter } from "./drizzle-compat.js";
import type { ScopedTable, ScopedTableRule, ScopeByColumnOptions } from "./types.js";

const TABLE_COLUMNS = Symbol.for("drizzle:Columns");

/** Create a scoping rule for the common case where one table column stores the scope value. */
export function scopeByColumn<TScope, TTable extends ScopedTable>(
  table: TTable,
  column: Column,
  options: ScopeByColumnOptions<TScope> = {},
): ScopedTableRule<TScope, TTable> {
  const columnName = options.columnName ?? getColumnName(column);
  const rqbV2Relational = createRqbV2RelationalSupport(table, column, columnName);
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
    relational: rqbV2Relational,
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

/** Build Drizzle 1.0 RQBv2 object-filter support for column-scoped rules. */
function createRqbV2RelationalSupport<TScope>(
  table: object,
  column: Column,
  columnName: string,
): ScopedTableRule<TScope>["relational"] {
  const objectFilterKey = getRqbV2ObjectFilterColumnKey(table, column, columnName);
  if (!objectFilterKey) {
    return undefined;
  }

  return {
    where: (scopeValue) => ({ [objectFilterKey]: scopeValue }),
    hasScopeInWhere: (condition) => containsRqbV2ObjectFilterColumn(condition, objectFilterKey),
  };
}

/** Resolve the TypeScript property key that RQBv2 object filters use for this column. */
function getRqbV2ObjectFilterColumnKey(
  table: object,
  column: Column,
  columnName: string,
): string | undefined {
  const columns = (table as Record<symbol, unknown>)[TABLE_COLUMNS];
  if (!isColumnMap(columns)) {
    return undefined;
  }

  for (const [key, candidate] of Object.entries(columns)) {
    if (candidate === column || hasColumnName(candidate, columnName)) {
      return key;
    }
  }

  return undefined;
}

function isColumnMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Check RQBv2 object filters for the scope column at the current table level or logical nesting. */
function containsRqbV2ObjectFilterColumn(condition: unknown, objectFilterKey: string): boolean {
  if (!isColumnMap(condition)) {
    return false;
  }

  if (Object.hasOwn(condition, objectFilterKey) && condition[objectFilterKey] !== undefined) {
    return true;
  }

  return (
    containsLogicalRqbV2ObjectFilter(condition.AND, objectFilterKey) ||
    containsLogicalRqbV2ObjectFilter(condition.OR, objectFilterKey) ||
    containsLogicalRqbV2ObjectFilter(condition.NOT, objectFilterKey)
  );
}

function containsLogicalRqbV2ObjectFilter(value: unknown, objectFilterKey: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsRqbV2ObjectFilterColumn(item, objectFilterKey));
  }

  return containsRqbV2ObjectFilterColumn(value, objectFilterKey);
}
