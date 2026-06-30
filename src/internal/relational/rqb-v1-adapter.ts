import type { RelationalWhere, RelationalWhereCallback, ScopedTableRule } from "../../types.js";
import type { NormalizedCreateScopedDbOptions } from "../options.js";
import {
  assertWhereAllowed,
  createMissingWhereError,
  getRuleTableName,
  isStrictMode,
  scopeCondition,
} from "../scope.js";
import {
  bindRelationalMethod,
  type RelationalMethod,
  type RelationalMethodConfig,
  type RelationalQueryAdapter,
  type RelationalTableQuery,
} from "./adapter.js";

/** Adapter for Drizzle's callback/SQL relational query API. */
export class RqbV1RelationalAdapter implements RelationalQueryAdapter {
  readonly name = "rqb-v1";

  supports(): boolean {
    return true;
  }

  wrap<TScope, TTableQuery extends RelationalTableQuery>(
    tableQuery: TTableQuery,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
  ): TTableQuery {
    return {
      findFirst: this.wrapMethod(bindRelationalMethod(tableQuery, "findFirst"), rule, options),
      findMany: this.wrapMethod(bindRelationalMethod(tableQuery, "findMany"), rule, options),
    } as TTableQuery;
  }

  /** Wrap a relational query method to validate and inject scoped predicates. */
  private wrapMethod<TScope, TResult>(
    originalMethod: RelationalMethod<RelationalWhere<unknown>, TResult>,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
  ): (config?: RelationalMethodConfig<RelationalWhere<unknown>>) => Promise<TResult> {
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
}
