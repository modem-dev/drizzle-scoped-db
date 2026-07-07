import { and, type Column, eq, getTableColumns, type SQL } from "drizzle-orm";

import { containsColumnFilter } from "./drizzle-compat.js";
import { createRqbV2ColumnObjectFilter } from "./internal/relational/rqb-v2-object-filter.js";
import { createColumnRelationalSupport } from "./internal/relational/rule-support.js";
import type {
  DefineScopedTableRule,
  RelationalObjectFilter,
  ScopeByColumnEntry,
  ScopeByColumnMapOptions,
  ScopeByPredicateEntry,
  ScopeByPredicateOptions,
  ScopedTable,
  ScopedTableRule,
  ScopeByColumnOptions,
  ScopeRule,
} from "./types.js";

/** Create a scoping rule for one column or a composite set of columns storing the scope value. */
export function scopeByColumn<TScope, TTable extends ScopedTable = ScopedTable>(
  table: TTable,
  column: Column,
  options?: ScopeByColumnOptions<TScope>,
): ScopeRule<TScope, TTable>;
export function scopeByColumn<TScope, TTable extends ScopedTable = ScopedTable>(
  table: TTable,
  columns: Record<string, ScopeByColumnEntry<TScope>>,
  options?: ScopeByColumnMapOptions,
): ScopeRule<TScope, TTable>;
export function scopeByColumn<TScope, TTable extends ScopedTable = ScopedTable>(
  table: TTable,
  columnOrColumns: Column | Record<string, ScopeByColumnEntry<TScope>>,
  options: ScopeByColumnOptions<TScope> | ScopeByColumnMapOptions = {},
): ScopeRule<TScope, TTable> {
  if (isColumnMap(columnOrColumns) && !("columnName" in options)) {
    return createCompositeColumnRule(table, columnOrColumns, options as ScopeByColumnMapOptions);
  }

  return createSingleColumnRule(
    table,
    columnOrColumns as Column,
    options as ScopeByColumnOptions<TScope>,
  );
}

/** Create a predicate scoping rule with strict validation derived from mentioned columns. */
export function scopeByPredicate<TScope, TTable extends ScopedTable = ScopedTable>(
  table: TTable,
  predicate: ScopeByPredicateEntry<TScope> | readonly ScopeByPredicateEntry<TScope>[],
  options: ScopeByPredicateOptions = {},
): ScopeRule<TScope, TTable> {
  const predicates = Array.isArray(predicate) ? predicate : [predicate];
  if (predicates.length === 0) {
    throw new Error("scopeByPredicate() requires at least one predicate.");
  }

  return {
    table,
    queryName: options.queryName,
    tableName: options.tableName,
    where: (scopeValue) => mergePredicateConditions(predicates, scopeValue),
    hasScopeInWhere: createStrictColumnsDetector(
      table,
      predicates.flatMap((entry) => entry.strictColumns),
    ),
  };
}

/** Create a custom scoping rule for internal predicates that need fully custom behavior. */
export function defineScopedTable<
  TScope,
  TTable extends ScopedTable,
  TInsert = Record<string, unknown>,
  TUpdate = Record<string, unknown>,
>(
  table: TTable,
  rule: DefineScopedTableRule<TScope, TTable, TInsert, TUpdate>,
): ScopedTableRule<TScope, TTable, TInsert, TUpdate> {
  return { table, ...rule };
}

function createSingleColumnRule<TScope, TTable extends ScopedTable>(
  table: TTable,
  column: Column,
  options: ScopeByColumnOptions<TScope>,
): ScopedTableRule<TScope, TTable> {
  const columnName = options.columnName ?? getColumnName(column);
  const equals = options.equals ?? Object.is;
  const inferredKey = inferColumnKey(table, column, columnName);
  const insertKey = options.insertKey === false ? undefined : (options.insertKey ?? inferredKey);
  const updateKey = options.updateKey === false ? undefined : (options.updateKey ?? insertKey);

  return {
    table,
    queryName: options.queryName,
    tableName: options.tableName,
    where: (scopeValue) => eq(column as Parameters<typeof eq>[0], scopeValue),
    validateInsert: insertKey
      ? (row, scopeValue) => equals((row as Record<string, unknown>)[insertKey], scopeValue)
      : undefined,
    validateUpdate: updateKey
      ? (payload, scopeValue) => {
          if (!(updateKey in (payload as Record<string, unknown>))) {
            return true;
          }
          return equals((payload as Record<string, unknown>)[updateKey], scopeValue);
        }
      : undefined,
    hasScopeInWhere: (condition) => containsColumnFilter(condition, columnName, table),
    relational: createColumnRelationalSupport(table, column, columnName),
  };
}

function createCompositeColumnRule<TScope, TTable extends ScopedTable>(
  table: TTable,
  columns: Record<string, ScopeByColumnEntry<TScope>>,
  options: ScopeByColumnMapOptions,
): ScopedTableRule<TScope, TTable> {
  const entries = Object.entries(columns).map(([key, entry]) => normalizeColumnEntry(key, entry));

  return {
    table,
    queryName: options.queryName,
    tableName: options.tableName,
    where: (scopeValue) =>
      and(
        ...entries.map((entry) =>
          eq(entry.column as Parameters<typeof eq>[0], entry.value(scopeValue)),
        ),
      ),
    validateInsert: (row, scopeValue) =>
      entries.every((entry) =>
        entry.insertKey === undefined
          ? true
          : entry.equals(
              (row as Record<string, unknown>)[entry.insertKey],
              entry.value(scopeValue),
            ),
      ),
    validateUpdate: (payload, scopeValue) =>
      entries.every((entry) => {
        if (
          entry.updateKey === undefined ||
          !(entry.updateKey in (payload as Record<string, unknown>))
        ) {
          return true;
        }
        return entry.equals(
          (payload as Record<string, unknown>)[entry.updateKey],
          entry.value(scopeValue),
        );
      }),
    hasScopeInWhere: (condition) =>
      entries.every((entry) => containsColumnFilter(condition, entry.columnName, table)),
    relational: createCompositeRelationalSupport(table, entries),
  };
}

/** Extract Drizzle's SQL column name from a column object. */
function getColumnName(column: Column, context = "scopeByColumn()"): string {
  const columnWithName = column as { name?: unknown };
  if (typeof columnWithName.name !== "string") {
    throw new Error(
      `Unable to infer Drizzle column name for ${context}. Pass \`columnName\` when using scopeByColumn().`,
    );
  }
  return columnWithName.name;
}

type NormalizedColumnEntry<TScope> = {
  column: Column;
  columnName: string;
  insertKey: string | undefined;
  updateKey: string | undefined;
  value: (scopeValue: TScope) => unknown;
  equals: (rowValue: unknown, scopeValue: unknown) => boolean;
};

function normalizeColumnEntry<TScope>(
  key: string,
  entry: ScopeByColumnEntry<TScope>,
): NormalizedColumnEntry<TScope> {
  const config = isColumnEntryConfig(entry) ? entry : { column: entry };
  const insertKey = config.insertKey === false ? undefined : (config.insertKey ?? key);
  const updateKey = config.updateKey === false ? undefined : (config.updateKey ?? insertKey);
  return {
    column: config.column,
    columnName: config.columnName ?? getColumnName(config.column),
    insertKey,
    updateKey,
    value:
      config.value ??
      ((scopeValue) => {
        if (typeof scopeValue !== "object" || scopeValue === null) {
          throw new Error(
            `scopeByColumn() column map "${key}" needs an object scope value to resolve, but received ${typeof scopeValue}. ` +
              "Use the single-column form for primitive scopes, or provide an explicit `value` resolver.",
          );
        }
        return (scopeValue as Record<string, unknown>)[key];
      }),
    equals: config.equals ?? Object.is,
  };
}

function inferColumnKey(
  table: ScopedTable,
  column: Column,
  columnName: string,
): string | undefined {
  const columns = getTableColumns(table);
  if (!columns) {
    return undefined;
  }

  const matchingKeys = Object.entries(columns)
    .filter(([, candidate]) => candidate === column || getColumnName(candidate) === columnName)
    .map(([key]) => key);

  return matchingKeys.length === 1 ? matchingKeys[0] : undefined;
}

function isColumnEntryConfig<TScope>(
  entry: ScopeByColumnEntry<TScope>,
): entry is Extract<ScopeByColumnEntry<TScope>, { column: Column }> {
  return typeof entry === "object" && entry !== null && "column" in entry;
}

function isColumnMap<TScope>(
  value: Column | Record<string, ScopeByColumnEntry<TScope>>,
): value is Record<string, ScopeByColumnEntry<TScope>> {
  return !isColumnLike(value) && Object.keys(value).length > 0;
}

function isColumnLike(value: unknown): value is Column {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as { name?: unknown }).name === "string" &&
    "table" in value
  );
}

function mergePredicateConditions<TScope>(
  predicates: readonly ScopeByPredicateEntry<TScope>[],
  scopeValue: TScope,
): SQL | undefined {
  const conditions = predicates.map((entry) => entry.where(scopeValue));
  if (conditions.some((condition) => !condition)) {
    return undefined;
  }
  return conditions.length === 1 ? conditions[0] : and(...(conditions as SQL[]));
}

function createStrictColumnsDetector(
  table: ScopedTable,
  strictColumns: readonly Column[],
): (condition: Parameters<typeof containsColumnFilter>[0]) => boolean {
  if (strictColumns.length === 0) {
    throw new Error("strict predicate validation requires at least one column.");
  }

  const columnNames = strictColumns.map((column) =>
    getColumnName(column, "scopeByPredicate() strictColumns"),
  );
  return (condition) =>
    columnNames.every((columnName) => containsColumnFilter(condition, columnName, table));
}

function createCompositeRelationalSupport<TScope>(
  table: object,
  entries: NormalizedColumnEntry<TScope>[],
): ScopedTableRule<TScope>["relational"] {
  const supports = entries.map((entry) =>
    createRqbV2ColumnObjectFilter<unknown>(table, entry.column, entry.columnName),
  );

  if (supports.some((support) => !support)) {
    return undefined;
  }

  const rqbV2Supports = supports as NonNullable<
    NonNullable<ScopedTableRule<unknown>["relational"]>["rqbV2"]
  >[];
  return {
    rqbV2: {
      where: (scopeValue) =>
        Object.assign(
          {},
          ...entries.map((entry, index) => rqbV2Supports[index]?.where(entry.value(scopeValue))),
        ) as RelationalObjectFilter,
      hasScopeInWhere: (condition) =>
        rqbV2Supports.every((support) => support.hasScopeInWhere?.(condition)),
    },
  };
}
