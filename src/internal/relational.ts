import type { RelationalWhere, RelationalWhereCallback, ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
import {
  assertWhereAllowed,
  createMissingWhereError,
  getRuleTableName,
  isStrictMode,
  scopeCondition,
} from "./scope.js";

/** Wrap findFirst/findMany for Drizzle's relational query API. */
export function createScopedTableQuery<
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
