import type { ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
import {
  assertNoRelationalWith,
  bindRelationalMethod,
  type RelationalMethod,
  type RelationalQueryAdapter,
  type RelationalTableQuery,
} from "./relational/adapter.js";
import { RqbV1RelationalAdapter } from "./relational/rqb-v1-adapter.js";
import { RqbV2RelationalAdapter } from "./relational/rqb-v2-adapter.js";
import type { RelationalSchemaResolver } from "./relational/schema.js";
import { scopeRelationalWith } from "./relational/with-scoping.js";

const RELATIONAL_ADAPTERS: RelationalQueryAdapter[] = [
  new RqbV2RelationalAdapter(),
  new RqbV1RelationalAdapter(),
];

/** Wrap findFirst/findMany for Drizzle's relational query API. */
export function createScopedTableQuery<TScope, TTableQuery extends RelationalTableQuery>(
  tableQuery: TTableQuery,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
  relationalSchema: RelationalSchemaResolver | undefined,
): TTableQuery {
  return getRelationalAdapter(tableQuery).wrap(tableQuery, rule, options, relationalSchema);
}

/**
 * Wrap an unscoped relational root. The root table itself is unscoped, but any nested `with` includes
 * that reach scoped tables still have their scope predicates injected (and fail closed when the
 * relational schema is unavailable), so an unscoped root cannot be used to load unscoped nested rows.
 */
export function createRelationalWithGuard<TScope, TTableQuery extends RelationalTableQuery>(
  tableQuery: TTableQuery,
  queryName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
  relationalSchema: RelationalSchemaResolver | undefined,
): TTableQuery {
  return new Proxy(tableQuery, {
    get(target, prop, receiver) {
      if (prop === "findFirst" || prop === "findMany") {
        return wrapWithGuard(
          bindRelationalMethod(target, prop),
          queryName,
          options,
          relationalSchema,
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapWithGuard<TScope, TResult>(
  originalMethod: RelationalMethod<unknown, TResult>,
  queryName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
  relationalSchema: RelationalSchemaResolver | undefined,
): RelationalMethod<unknown, TResult> {
  return (config) => {
    if (!relationalSchema) {
      assertNoRelationalWith(config, queryName);
      return originalMethod(config);
    }

    const scopedConfig = scopeRelationalWith(
      config as Record<string, unknown> | undefined,
      relationalSchema.relationsForTsName(queryName),
      relationalSchema,
      options,
      queryName,
    );
    return originalMethod(scopedConfig);
  };
}

function getRelationalAdapter(tableQuery: object): RelationalQueryAdapter {
  return RELATIONAL_ADAPTERS.find((candidate) =>
    candidate.supports(tableQuery),
  ) as RelationalQueryAdapter;
}
