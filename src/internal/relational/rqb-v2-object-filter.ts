import type { Column } from "drizzle-orm";

import type { ScopedTableRule } from "../../types.js";

const TABLE_COLUMNS = Symbol.for("drizzle:Columns");

type RqbV2RelationalSupport<TScope> = NonNullable<ScopedTableRule<TScope>["relational"]>["rqbV2"];

/** Build Drizzle 1.0 RQBv2 object-filter support for column-scoped rules. */
export function createRqbV2ColumnObjectFilter<TScope>(
  table: object,
  column: Column,
  columnName: string,
): RqbV2RelationalSupport<TScope> | undefined {
  const objectFilterKey = getObjectFilterColumnKey(table, column, columnName);
  if (!objectFilterKey) {
    return undefined;
  }

  return {
    where: (scopeValue) => ({ [objectFilterKey]: scopeValue }),
    hasScopeInWhere: (condition) => containsObjectFilterColumn(condition, objectFilterKey),
  };
}

/** Resolve the TypeScript property key that RQBv2 object filters use for this column. */
function getObjectFilterColumnKey(
  table: object,
  column: Column,
  columnName: string,
): string | undefined {
  const columns = (table as Record<symbol, unknown>)[TABLE_COLUMNS];
  if (!isObjectRecord(columns)) {
    return undefined;
  }

  for (const [key, candidate] of Object.entries(columns)) {
    if (candidate === column || hasColumnName(candidate, columnName)) {
      return key;
    }
  }

  return undefined;
}

function hasColumnName(candidate: unknown, columnName: string): boolean {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "name" in candidate &&
    (candidate as { name?: unknown }).name === columnName
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Check RQBv2 object filters for the scope column at the current table level or logical nesting. */
function containsObjectFilterColumn(condition: unknown, objectFilterKey: string): boolean {
  if (!isObjectRecord(condition)) {
    return false;
  }

  if (Object.hasOwn(condition, objectFilterKey) && condition[objectFilterKey] !== undefined) {
    return true;
  }

  return (
    containsLogicalObjectFilter(condition.AND, objectFilterKey) ||
    containsLogicalObjectFilter(condition.OR, objectFilterKey) ||
    containsLogicalObjectFilter(condition.NOT, objectFilterKey)
  );
}

function containsLogicalObjectFilter(value: unknown, objectFilterKey: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsObjectFilterColumn(item, objectFilterKey));
  }

  return containsObjectFilterColumn(value, objectFilterKey);
}
