import type { RelationalObjectFilter, ScopedTableRule } from "../../types.js";
import type { NormalizedCreateScopedDbOptions } from "../options.js";
import {
  createMissingScopeError,
  createMissingWhereError,
  getRuleTableName,
  isStrictMode,
} from "../scope.js";
import {
  assertNoRelationalWith,
  bindRelationalMethod,
  type RelationalMethod,
  type RelationalMethodConfig,
  type RelationalQueryAdapter,
  type RelationalTableQuery,
} from "./adapter.js";

const ENTITY_KIND = Symbol.for("drizzle:entityKind");

/** Adapter for Drizzle 1.0's RQBv2 object-filter relational query API. */
export class RqbV2RelationalAdapter implements RelationalQueryAdapter {
  readonly name = "rqb-v2";

  supports(tableQuery: object): boolean {
    const constructor = tableQuery.constructor as unknown as Record<symbol, unknown> | undefined;
    const entityKind = constructor?.[ENTITY_KIND];
    return typeof entityKind === "string" && entityKind.endsWith("V2");
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

  /** Wrap an RQBv2 relational query method to validate and inject scoped object filters. */
  private wrapMethod<TScope, TResult>(
    originalMethod: RelationalMethod<RelationalObjectFilter, TResult>,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
  ): (config?: RelationalMethodConfig<RelationalObjectFilter>) => Promise<TResult> {
    return (config) => {
      assertNoRelationalWith(config, getRuleTableName(rule));
      const originalWhere = config?.where;

      this.assertSupportedWhere(originalWhere, rule, options);
      this.assertWhereAllowed(originalWhere, rule, options);

      const scopedWhere = rule.relational?.rqbV2?.where(options.scopeValue);
      if (!scopedWhere) {
        throw this.createUnsupportedRuleError(rule);
      }

      return originalMethod({
        ...config,
        where: this.mergeWhere(originalWhere, scopedWhere),
      });
    };
  }

  /** Validate that the user-supplied object filter satisfies strict scoped-query rules. */
  private assertWhereAllowed<TScope>(
    where: RelationalObjectFilter | undefined,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
  ): void {
    if (!where && isStrictMode(options)) {
      throw createMissingWhereError(getRuleTableName(rule), options);
    }

    if (isStrictMode(options) && !rule.relational?.rqbV2?.hasScopeInWhere?.(where)) {
      throw createMissingScopeError(getRuleTableName(rule), options);
    }
  }

  /** Compose a user object-filter with the mandatory scope filter in RQBv2's own language. */
  private mergeWhere(
    userWhere: RelationalObjectFilter | undefined,
    scopedWhere: RelationalObjectFilter,
  ): RelationalObjectFilter {
    return userWhere ? { AND: [userWhere, scopedWhere] } : scopedWhere;
  }

  /** RQBv2 does not accept v1 callback/SQL where shapes. Reject them before Drizzle can ignore them. */
  private assertSupportedWhere<TScope>(
    where: RelationalObjectFilter | undefined,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
  ): void {
    if (where === undefined) {
      return;
    }

    if (
      typeof where !== "object" ||
      where === null ||
      Array.isArray(where) ||
      this.isSqlLike(where)
    ) {
      throw new Error(
        `Unsupported RQBv2 relational where for scoped table "${getRuleTableName(rule)}". ` +
          `Use Drizzle 1.0 object filters so ${options.scopeName} scoping can be enforced.`,
      );
    }
  }

  private isSqlLike(value: object): boolean {
    return "queryChunks" in value || "getSQL" in value;
  }

  private createUnsupportedRuleError<TScope>(rule: ScopedTableRule<TScope>): Error {
    return new Error(
      `Scoped table "${getRuleTableName(rule)}" cannot be used through Drizzle RQBv2 because its rule does not declare a relational object-filter scope.`,
    );
  }
}
