import {
  and,
  type Column,
  eq,
  getTableName as drizzleGetTableName,
  type SQL,
  type Table,
  type TableConfig,
} from "drizzle-orm";

/** Table type used by Drizzle's PostgreSQL query builders. */
export type ScopedTable = Table<TableConfig> & {
  $inferSelect?: Record<string, unknown>;
};

/** A callback that receives a Drizzle relational table proxy and operators, then returns a SQL predicate. */
export type RelationalWhereCallback<TTable> = (
  table: TTable,
  operators: {
    and: typeof and;
    eq: typeof eq;
    or: typeof import("drizzle-orm").or;
    [key: string]: unknown;
  },
) => SQL | undefined;

/** A relational query where clause, either as Drizzle SQL or as Drizzle's callback form. */
export type RelationalWhere<TTable> = RelationalWhereCallback<TTable> | SQL | undefined;

/** Error thrown when scoped query execution requires a where clause but none was supplied. */
export class MissingScopedWhereError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(
      `Query on table "${tableName}" is missing a where clause required by ${scopeName} scoping.`,
    );
    this.name = "MissingScopedWhereError";
  }
}

/** Error thrown when a strict scoped query where clause does not include the declared scope. */
export class MissingScopedPredicateError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(`Query on table "${tableName}" is missing the declared ${scopeName} scope predicate.`);
    this.name = "MissingScopedPredicateError";
  }
}

/** Error thrown when a scoped insert row is missing or has a mismatched scope value. */
export class InvalidScopedInsertError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(
      `Insert on table "${tableName}" is missing or has a mismatched ${scopeName} scope value.`,
    );
    this.name = "InvalidScopedInsertError";
  }
}

/** A table-specific scoping rule. */
export type ScopedTableRule<
  TScope,
  TTable extends ScopedTable = ScopedTable,
  TInsert = Record<string, unknown>,
> = {
  /** Drizzle table object that this rule protects. */
  table: TTable;
  /** Optional db.query property name for Drizzle relational query API support. */
  queryName?: string;
  /** Human-readable table name used in errors. Defaults to Drizzle's SQL table name. */
  tableName?: string;
  /** Predicate that is always injected into scoped select/update/delete/find queries. */
  where: (scopeValue: TScope) => SQL | undefined;
  /** Optional insert row validator. Return true only when the row belongs to scopeValue. */
  validateInsert?: (row: TInsert, scopeValue: TScope) => boolean;
  /**
   * Optional strict-mode validator for checking whether user-supplied where already includes scope.
   * Required when `strict` mode is enabled; rules without a detector fail strict validation.
   */
  hasScopeInWhere?: (condition: SQL | undefined) => boolean;
};

/** Error customization hooks for scoped wrappers. */
export type ScopedDbErrors<TScope> = {
  missingWhere?: (tableName: string, scopeName: string, scopeValue: TScope) => Error;
  missingScope?: (tableName: string, scopeName: string, scopeValue: TScope) => Error;
  invalidInsert?: (
    tableName: string,
    row: Record<string, unknown>,
    scopeName: string,
    scopeValue: TScope,
  ) => Error;
};

/** Options for creating a scoped Drizzle wrapper. */
export type CreateScopedDbOptions<TScope> = {
  /** Human-readable scope name, for example `organization`, `tenant`, or `workspace`. */
  scopeName: string;
  /** The current scope value that will be injected into protected queries. */
  scopeValue: TScope;
  /** Table-specific scoping rules. Tables without rules pass through unchanged. */
  rules: ScopedTableRule<TScope>[];
  /**
   * Strict mode requires callers to provide `.where(...)` and include the declared scope predicate.
   * Defaults to `true`; pass `false` to allow implicit scope-only queries.
   */
  strict?: boolean;
  /** Property name for the intentionally unsafe unscoped DB escape hatch. Defaults to `_unsafeUnscopedDb`. */
  unscopedDbPropertyName?: string;
  /** Optional property name that exposes the current scope value. */
  scopeValueProperty?: string;
  /** Optional custom JSON serialization hook. */
  toJSON?: (scopeValue: TScope, scopeName: string) => unknown;
  /** Optional extension methods/properties copied onto every scoped wrapper, including transactions. */
  extensions?: (scopeValue: TScope, scopeName: string) => Record<string, unknown>;
  /** Optional error factories. */
  errors?: ScopedDbErrors<TScope>;
};

/** Minimal Drizzle-like surface used internally by the wrapper. */
type DrizzleLikeDb = {
  query?: Record<PropertyKey, unknown>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and selection-specific.
  select: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and selection-specific.
  selectDistinct: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and selection-specific.
  selectDistinctOn?: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and table-specific.
  insert: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and table-specific.
  update: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and table-specific.
  delete: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Transaction callback receives driver-specific transaction types.
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Execute arguments are driver-specific.
  execute?: (...args: any[]) => unknown;
};

/** Options for the column-based scoping shortcut. */
export type ScopeByColumnOptions<TScope> = {
  /** Optional db.query property name for relational query API support. */
  queryName?: string;
  /** Human-readable table name used in errors. */
  tableName?: string;
  /** Insert row property that should equal the current scope value. */
  insertKey?: string;
  /** SQL column name used by strict validation. Defaults to the Drizzle column name. */
  columnName?: string;
  /** Custom equality function for insert validation. Defaults to Object.is. */
  equals?: (rowValue: unknown, scopeValue: TScope) => boolean;
};

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

/** Create a Drizzle wrapper that injects declared table scope predicates. */
export function createScopedDb<TDb extends object, TScope>(
  db: TDb,
  options: CreateScopedDbOptions<TScope>,
): TDb {
  return createScopedDbInternal(db, normalizeOptions(options));
}

/** Normalized options with defaults applied once per wrapper tree. */
type RuleIndexes<TScope> = {
  rulesByTable: WeakMap<object, ScopedTableRule<TScope>>;
  rulesByQueryName: Map<string, ScopedTableRule<TScope>>;
};

type NormalizedCreateScopedDbOptions<TScope> = Required<
  Pick<CreateScopedDbOptions<TScope>, "unscopedDbPropertyName">
> &
  Omit<CreateScopedDbOptions<TScope>, "unscopedDbPropertyName"> &
  RuleIndexes<TScope>;

const ruleIndexCache = new WeakMap<ScopedTableRule<unknown>[], RuleIndexes<unknown>>();

/** Normalize options and precompute rule lookup maps. */
function normalizeOptions<TScope>(
  options: CreateScopedDbOptions<TScope>,
): NormalizedCreateScopedDbOptions<TScope> {
  const ruleIndexes = getRuleIndexes(options.rules);

  return {
    ...options,
    unscopedDbPropertyName: options.unscopedDbPropertyName ?? "_unsafeUnscopedDb",
    ...ruleIndexes,
  };
}

/** Build rule lookup indexes once for stable rule arrays so cached scoped DBs do not duplicate them per scope value. */
function getRuleIndexes<TScope>(rules: ScopedTableRule<TScope>[]): RuleIndexes<TScope> {
  const cacheKey = rules as ScopedTableRule<unknown>[];
  const cached = ruleIndexCache.get(cacheKey);
  if (cached) {
    return cached as RuleIndexes<TScope>;
  }

  const rulesByTable = new WeakMap<object, ScopedTableRule<TScope>>();
  const rulesByQueryName = new Map<string, ScopedTableRule<TScope>>();

  for (const rule of rules) {
    rulesByTable.set(rule.table, rule);
    if (rule.queryName) {
      rulesByQueryName.set(rule.queryName, rule);
    }
  }

  const ruleIndexes = { rulesByTable, rulesByQueryName };
  ruleIndexCache.set(cacheKey, ruleIndexes as RuleIndexes<unknown>);
  return ruleIndexes;
}

/** Type helper to infer selected values from a Drizzle selection object. */
type InferSelection<T> = {
  [K in keyof T]: T[K] extends Column<infer Config> ? Config["data"] : never;
};

/** Query builder returned after selecting from a scoped table. */
interface ScopedQueryBuilder<
  TTable extends ScopedTable,
  TResult = NonNullable<TTable["$inferSelect"]>[],
> {
  where(condition: SQL | undefined): ScopedWhereBuilder<TResult>;
  leftJoin<TJoinTable extends Table<TableConfig>>(
    table: TJoinTable,
    on: SQL,
  ): ScopedQueryBuilder<TTable, TResult>;
  innerJoin<TJoinTable extends Table<TableConfig>>(
    table: TJoinTable,
    on: SQL,
  ): ScopedQueryBuilder<TTable, TResult>;
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

/** Query builder returned after `.where(...)` is called. */
interface ScopedWhereBuilder<TResult> extends Promise<TResult> {
  limit(n: number): ScopedWhereBuilder<TResult>;
  offset(n: number): ScopedWhereBuilder<TResult>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
  orderBy(...columns: any[]): ScopedWhereBuilder<TResult>;
}

/** Select builder facade that scopes only tables with matching rules. */
interface ScopedSelectBuilder<TSelection = undefined> {
  from<TTable extends ScopedTable>(
    table: TTable,
  ): ScopedQueryBuilder<
    TTable,
    TSelection extends undefined
      ? NonNullable<TTable["$inferSelect"]>[]
      : InferSelection<TSelection>[]
  >;
}

/** Build a scoped select/selectDistinct/selectDistinctOn facade. */
function createScopedSelectBuilder<TScope, TSelection>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle select builders have overloaded generic shapes.
  selectBuilder: any,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedSelectBuilder<TSelection> {
  return {
    from<TTable extends ScopedTable>(
      table: TTable,
    ): ScopedQueryBuilder<
      TTable,
      TSelection extends undefined
        ? NonNullable<TTable["$inferSelect"]>[]
        : InferSelection<TSelection>[]
    > {
      const fromBuilder = selectBuilder.from(table);
      const rule = options.rulesByTable.get(table);

      if (!rule) {
        return fromBuilder;
      }

      // oxlint-disable-next-line typescript/no-explicit-any -- Return type depends on selection and table inference.
      return createScopedFromBuilder(fromBuilder, rule, options) as any;
    },
  };
}

/** Build a scoped query builder for select queries on a protected table. */
function createScopedFromBuilder<
  TScope,
  TTable extends ScopedTable,
  TResult = NonNullable<TTable["$inferSelect"]>[],
>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle builder internals are intentionally opaque.
  builder: any,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedQueryBuilder<TTable, TResult> {
  return {
    where(condition: SQL | undefined): ScopedWhereBuilder<TResult> {
      assertWhereAllowed(condition, rule, options);
      return builder.where(scopeCondition(condition, rule, options)) as ScopedWhereBuilder<TResult>;
    },

    leftJoin<TJoinTable extends Table<TableConfig>>(joinTable: TJoinTable, on: SQL) {
      return createScopedFromBuilder(builder.leftJoin(joinTable, on), rule, options);
    },

    innerJoin<TJoinTable extends Table<TableConfig>>(joinTable: TJoinTable, on: SQL) {
      return createScopedFromBuilder(builder.innerJoin(joinTable, on), rule, options);
    },

    // oxlint-disable-next-line unicorn/no-thenable -- Query builders intentionally act as thenables to catch direct awaits.
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      assertWhereAllowed(undefined, rule, options);
      return Promise.resolve(builder.where(scopeCondition(undefined, rule, options))).then(
        onfulfilled,
        onrejected,
      );
    },
  };
}

/** Wrap findFirst/findMany for Drizzle's relational query API. */
function createScopedTableQuery<
  TScope,
  TTableQuery extends { findFirst: unknown; findMany: unknown },
>(
  tableQuery: TTableQuery,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): TTableQuery {
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle relational method config types are table-specific.
  const callFindFirst = (config?: any) => (tableQuery.findFirst as any).call(tableQuery, config);
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle relational method config types are table-specific.
  const callFindMany = (config?: any) => (tableQuery.findMany as any).call(tableQuery, config);

  return {
    findFirst: wrapRelationalMethod(callFindFirst, rule, options),
    findMany: wrapRelationalMethod(callFindMany, rule, options),
  } as TTableQuery;
}

/** Wrap a relational query method to validate and inject scoped predicates. */
function wrapRelationalMethod<TScope, TResult>(
  originalMethod: (config?: {
    where?: RelationalWhere<unknown>;
    [key: string]: unknown;
  }) => Promise<TResult>,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): (config?: { where?: RelationalWhere<unknown>; [key: string]: unknown }) => Promise<TResult> {
  return (config) => {
    const originalWhere = config?.where;

    if (originalWhere === undefined && isStrictMode(options)) {
      throw createMissingWhereError(getRuleTableName(rule), options);
    }

    const wrappedWhere: RelationalWhereCallback<unknown> = (table, operators) => {
      const userCondition =
        typeof originalWhere === "function" ? originalWhere(table, operators) : originalWhere;
      assertWhereAllowed(userCondition, rule, options);
      return scopeCondition(userCondition, rule, options);
    };

    return originalMethod({
      ...config,
      where: wrappedWhere,
    });
  };
}

/** Create an insert builder that validates scoped values. */
function createScopedInsertBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
) {
  const dbRecord = db as DrizzleLikeDb;
  const insertBuilder = dbRecord.insert(table);

  return {
    values(valuesOrArray: Record<string, unknown> | Record<string, unknown>[]) {
      const valuesArray = Array.isArray(valuesOrArray) ? valuesOrArray : [valuesOrArray];

      if (rule.validateInsert) {
        for (const row of valuesArray) {
          if (!rule.validateInsert(row, options.scopeValue)) {
            throw createInvalidInsertError(getRuleTableName(rule), row, options);
          }
        }
      }

      return insertBuilder.values(valuesOrArray);
    },
  };
}

/** Create an update builder that injects scoped predicates into where clauses. */
function createScopedUpdateBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
) {
  const dbRecord = db as DrizzleLikeDb;
  const updateBuilder = dbRecord.update(table);

  return {
    set(values: Record<string, unknown>) {
      const setBuilder = updateBuilder.set(values);

      return {
        where(condition: SQL | undefined) {
          assertWhereAllowed(condition, rule, options);
          return setBuilder.where(scopeCondition(condition, rule, options));
        },
      };
    },
  };
}

/** Create a delete builder that injects scoped predicates into where clauses. */
function createScopedDeleteBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
) {
  const dbRecord = db as DrizzleLikeDb;
  const deleteBuilder = dbRecord.delete(table);

  return {
    where(condition: SQL | undefined) {
      assertWhereAllowed(condition, rule, options);
      return deleteBuilder.where(scopeCondition(condition, rule, options));
    },
  };
}

/** Internal wrapper constructor reused by root wrappers and transaction wrappers. */
function createScopedDbInternal<TDb extends object, TScope>(
  db: TDb,
  options: NormalizedCreateScopedDbOptions<TScope>,
): TDb {
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
      const rule = options.rulesByTable.get(table);
      return rule ? createScopedInsertBuilder(db, table, rule, options) : dbRecord.insert(table);
    },

    update<TTable extends ScopedTable>(table: TTable) {
      const rule = options.rulesByTable.get(table);
      return rule ? createScopedUpdateBuilder(db, table, rule, options) : dbRecord.update(table);
    },

    delete<TTable extends ScopedTable>(table: TTable) {
      const rule = options.rulesByTable.get(table);
      return rule ? createScopedDeleteBuilder(db, table, rule, options) : dbRecord.delete(table);
    },

    query: queryProxy,

    async transaction<T>(callback: (tx: TDb) => Promise<T>): Promise<T> {
      return dbRecord.transaction(async (tx: TDb) => callback(createScopedDbInternal(tx, options)));
    },

    execute: typeof dbRecord.execute === "function" ? dbRecord.execute.bind(db) : undefined,
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

  return scoped as TDb;
}

/** Validate required user-supplied where shape for a scoped table. */
function assertWhereAllowed<TScope>(
  condition: SQL | undefined,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): void {
  if (!condition && isStrictMode(options)) {
    throw createMissingWhereError(getRuleTableName(rule), options);
  }

  if (isStrictMode(options) && !rule.hasScopeInWhere?.(condition)) {
    throw createMissingScopeError(getRuleTableName(rule), options);
  }
}

/** Strict mode is enabled by default; callers must explicitly opt out. */
function isStrictMode<TScope>(options: NormalizedCreateScopedDbOptions<TScope>): boolean {
  return options.strict !== false;
}

/** Combine a user condition with the table's declared scope predicate. */
function scopeCondition<TScope>(
  condition: SQL | undefined,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): SQL | undefined {
  const scopedPredicate = rule.where(options.scopeValue);
  if (!condition) {
    return scopedPredicate;
  }
  if (!scopedPredicate) {
    return condition;
  }
  return and(condition, scopedPredicate);
}

/** Resolve a rule's table name. */
function getRuleTableName<TScope>(rule: ScopedTableRule<TScope>): string {
  return rule.tableName ?? drizzleGetTableName(rule.table);
}

/** Create the configured missing-where error. */
function createMissingWhereError<TScope>(
  tableName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.missingWhere?.(tableName, options.scopeName, options.scopeValue) ??
    new MissingScopedWhereError(options.scopeName, tableName)
  );
}

/** Create the configured missing-scope error. */
function createMissingScopeError<TScope>(
  tableName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.missingScope?.(tableName, options.scopeName, options.scopeValue) ??
    new MissingScopedPredicateError(options.scopeName, tableName)
  );
}

/** Create the configured invalid-insert error. */
function createInvalidInsertError<TScope>(
  tableName: string,
  row: Record<string, unknown>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.invalidInsert?.(tableName, row, options.scopeName, options.scopeValue) ??
    new InvalidScopedInsertError(options.scopeName, tableName)
  );
}

/** Extract Drizzle's SQL column name from a column object. */
function getColumnName(column: Column): string {
  const columnWithName = column as { name?: unknown };
  if (typeof columnWithName.name !== "string") {
    throw new Error("Unable to infer Drizzle column name. Pass `columnName` to scopeByColumn().");
  }
  return columnWithName.name;
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
