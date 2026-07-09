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
  assertNoRelationalWith,
  bindRelationalMethod,
  type RelationalMethod,
  type RelationalMethodConfig,
  type RelationalQueryAdapter,
  type RelationalTableQuery,
} from "./adapter.js";
import type { RelationalSchemaResolver } from "./schema.js";
import { scopeRelationalWith } from "./with-scoping.js";

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
    relationalSchema: RelationalSchemaResolver | undefined,
  ): TTableQuery {
    return {
      findFirst: this.wrapMethod(
        bindRelationalMethod(tableQuery, "findFirst"),
        rule,
        options,
        relationalSchema,
      ),
      findMany: this.wrapMethod(
        bindRelationalMethod(tableQuery, "findMany"),
        rule,
        options,
        relationalSchema,
      ),
    } as TTableQuery;
  }

  /** Wrap a relational query method to validate and inject scoped predicates. */
  private wrapMethod<TScope, TResult>(
    originalMethod: RelationalMethod<RelationalWhere<unknown>, TResult>,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
    relationalSchema: RelationalSchemaResolver | undefined,
  ): (config?: RelationalMethodConfig<RelationalWhere<unknown>>) => Promise<TResult> {
    return (config) => {
      const scopedConfig = this.scopeIncludes(config, rule, options, relationalSchema);
      const originalWhere = scopedConfig?.where;

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
        ...scopedConfig,
        where: wrappedWhere,
      });
    };
  }

  /**
   * Inject scope predicates into nested `with` includes. Fails closed for nested includes when the
   * relational schema is unavailable, since without it a nested relation cannot be scoped.
   */
  private scopeIncludes<TScope>(
    config: RelationalMethodConfig<RelationalWhere<unknown>> | undefined,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
    relationalSchema: RelationalSchemaResolver | undefined,
  ): RelationalMethodConfig<RelationalWhere<unknown>> | undefined {
    if (!relationalSchema) {
      assertNoRelationalWith(config, getRuleTableName(rule));
      return config;
    }

    return scopeRelationalWith(
      config,
      relationalSchema.relationsForTable(rule.table),
      relationalSchema,
      options,
      getRuleTableName(rule),
    ) as RelationalMethodConfig<RelationalWhere<unknown>> | undefined;
  }
}
