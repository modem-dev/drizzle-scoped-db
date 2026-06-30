import type { RelationalObjectWhere, ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
import { assertRelationalWhereAllowed, getRuleTableName } from "./scope.js";

/** Wrap findFirst/findMany for Drizzle 1.0's RQBv2 object-filter relational query API. */
export function createScopedRqbV2TableQuery<
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
    findFirst: wrapRelationalObjectMethod(callFindFirst, rule, options),
    findMany: wrapRelationalObjectMethod(callFindMany, rule, options),
  } as TTableQuery;
}

/** Wrap an RQBv2 relational query method to validate and inject scoped object filters. */
function wrapRelationalObjectMethod<TScope, TResult>(
  originalMethod: (config?: {
    where?: RelationalObjectWhere;
    [key: string]: unknown;
  }) => Promise<TResult>,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): (config?: { where?: RelationalObjectWhere; [key: string]: unknown }) => Promise<TResult> {
  return (config) => {
    const originalWhere = config?.where;

    assertSupportedRqbV2Where(originalWhere, rule, options);
    assertRelationalWhereAllowed(originalWhere, rule, options);

    const scopedWhere = rule.relational?.where(options.scopeValue);
    if (!scopedWhere) {
      throw createUnsupportedRqbV2RuleError(rule);
    }

    return originalMethod({
      ...config,
      where: mergeRelationalObjectWhere(originalWhere, scopedWhere),
    });
  };
}

/** Compose a user object-filter with the mandatory scope filter in RQBv2's own language. */
function mergeRelationalObjectWhere(
  userWhere: RelationalObjectWhere | undefined,
  scopedWhere: RelationalObjectWhere,
): RelationalObjectWhere {
  return userWhere ? { AND: [userWhere, scopedWhere] } : scopedWhere;
}

/** RQBv2 does not accept v1 callback/SQL where shapes. Reject them before Drizzle can ignore them. */
function assertSupportedRqbV2Where<TScope>(
  where: RelationalObjectWhere | undefined,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): void {
  if (where === undefined) {
    return;
  }

  if (typeof where !== "object" || where === null || Array.isArray(where) || isSqlLike(where)) {
    throw new Error(
      `Unsupported RQBv2 relational where for scoped table "${getRuleTableName(rule)}". ` +
        `Use Drizzle 1.0 object filters so ${options.scopeName} scoping can be enforced.`,
    );
  }
}

function isSqlLike(value: object): boolean {
  return "queryChunks" in value || "getSQL" in value;
}

function createUnsupportedRqbV2RuleError<TScope>(rule: ScopedTableRule<TScope>): Error {
  return new Error(
    `Scoped table "${getRuleTableName(rule)}" cannot be used through Drizzle RQBv2 because its rule does not declare a relational object-filter scope.`,
  );
}
