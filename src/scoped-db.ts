import type { CreateScopedDbOptions, ScopedDb, ScopedTable } from "./types.js";
import {
  createScopedDeleteBuilder,
  createScopedInsertBuilder,
  createScopedUpdateBuilder,
} from "./internal/mutations.js";
import {
  type DrizzleLikeDb,
  getRuleForTable,
  type NormalizedCreateScopedDbOptions,
  normalizeOptions,
} from "./internal/options.js";
import { createScopedTableQuery } from "./internal/relational.js";
import { createScopedSelectBuilder } from "./internal/select.js";

/** Create a Drizzle wrapper that injects declared table scope predicates. */
export function createScopedDb<
  TDb extends object,
  TScope,
  TExtensions extends Record<string, unknown> = {},
  TUnscopedDbPropertyName extends string = "_unsafeUnscopedDb",
  TScopeValuePropertyName extends string | undefined = undefined,
>(
  db: TDb,
  options: CreateScopedDbOptions<
    TScope,
    TExtensions,
    TUnscopedDbPropertyName,
    TScopeValuePropertyName
  >,
): ScopedDb<TDb, TScope, TExtensions, TUnscopedDbPropertyName, TScopeValuePropertyName> {
  return createScopedDbInternal(db, normalizeOptions(options));
}

/** Internal wrapper constructor reused by root wrappers and transaction wrappers. */
function createScopedDbInternal<
  TDb extends object,
  TScope,
  TExtensions extends Record<string, unknown> = {},
  TUnscopedDbPropertyName extends string = "_unsafeUnscopedDb",
  TScopeValuePropertyName extends string | undefined = undefined,
>(
  db: TDb,
  options: NormalizedCreateScopedDbOptions<
    TScope,
    TExtensions,
    TUnscopedDbPropertyName,
    TScopeValuePropertyName
  >,
): ScopedDb<TDb, TScope, TExtensions, TUnscopedDbPropertyName, TScopeValuePropertyName> {
  const dbRecord = db as DrizzleLikeDb;
  const wrappedTableQueryCache = new Map<string, unknown>();
  const rawQuery = dbRecord.query;
  const queryProxy = rawQuery
    ? new Proxy(rawQuery, {
        get(target, prop: string | symbol) {
          if (typeof prop !== "string") {
            return target[prop as keyof typeof target];
          }

          const cached = wrappedTableQueryCache.get(prop);
          if (cached !== undefined) {
            return cached;
          }

          const tableQuery = target[prop as keyof typeof target];
          if (
            !tableQuery ||
            typeof tableQuery !== "object" ||
            !("findFirst" in tableQuery) ||
            !("findMany" in tableQuery)
          ) {
            return tableQuery;
          }

          const rule = options.rulesByQueryName.get(prop);
          if (!rule) {
            return tableQuery;
          }

          const wrapped = createScopedTableQuery(
            tableQuery as { findFirst: unknown; findMany: unknown },
            rule,
            options,
          );
          wrappedTableQueryCache.set(prop, wrapped);
          return wrapped;
        },
      })
    : undefined;

  const scoped: Record<string, unknown> = {
    select<TSelection extends Record<string, unknown> | undefined = undefined>(
      columns?: TSelection,
    ) {
      const selectBuilder = columns ? dbRecord.select(columns) : dbRecord.select();
      return createScopedSelectBuilder(selectBuilder, options);
    },

    selectDistinct<TSelection extends Record<string, unknown> | undefined = undefined>(
      columns?: TSelection,
    ) {
      const selectBuilder = columns ? dbRecord.selectDistinct(columns) : dbRecord.selectDistinct();
      return createScopedSelectBuilder(selectBuilder, options);
    },

    insert<TTable extends ScopedTable>(table: TTable) {
      const rule = getRuleForTable(table, options);
      return rule ? createScopedInsertBuilder(db, table, rule, options) : dbRecord.insert(table);
    },

    update<TTable extends ScopedTable>(table: TTable) {
      const rule = getRuleForTable(table, options);
      return rule ? createScopedUpdateBuilder(db, table, rule, options) : dbRecord.update(table);
    },

    delete<TTable extends ScopedTable>(table: TTable) {
      const rule = getRuleForTable(table, options);
      return rule ? createScopedDeleteBuilder(db, table, rule, options) : dbRecord.delete(table);
    },

    query: queryProxy,

    async transaction<T>(
      callback: (
        tx: ScopedDb<TDb, TScope, TExtensions, TUnscopedDbPropertyName, TScopeValuePropertyName>,
      ) => Promise<T>,
    ): Promise<T> {
      return dbRecord.transaction(async (tx: TDb) => callback(createScopedDbInternal(tx, options)));
    },
  };

  if (typeof dbRecord.selectDistinctOn === "function") {
    const selectDistinctOn = dbRecord.selectDistinctOn.bind(dbRecord);
    scoped.selectDistinctOn = function scopedSelectDistinctOn<
      TSelection extends Record<string, unknown> | undefined = undefined,
    >(
      // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle's column types are complex.
      onColumns: any[],
      columns?: TSelection,
    ) {
      const selectBuilder = columns
        ? selectDistinctOn(onColumns, columns)
        : selectDistinctOn(onColumns);
      return createScopedSelectBuilder(selectBuilder, options);
    };
  }

  Object.defineProperty(scoped, options.unscopedDbPropertyName, {
    enumerable: true,
    get: () => db,
  });

  if (options.scopeValueProperty) {
    Object.defineProperty(scoped, options.scopeValueProperty, {
      enumerable: true,
      get: () => options.scopeValue,
    });
  }

  if (options.toJSON) {
    scoped.toJSON = () => options.toJSON?.(options.scopeValue, options.scopeName);
  }

  if (options.extensions) {
    Object.assign(scoped, options.extensions(options.scopeValue, options.scopeName));
  }

  return scoped as ScopedDb<
    TDb,
    TScope,
    TExtensions,
    TUnscopedDbPropertyName,
    TScopeValuePropertyName
  >;
}
