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

const RELATIONAL_ADAPTERS: RelationalQueryAdapter[] = [
  new RqbV2RelationalAdapter(),
  new RqbV1RelationalAdapter(),
];

/** Wrap findFirst/findMany for Drizzle's relational query API. */
export function createScopedTableQuery<TScope, TTableQuery extends RelationalTableQuery>(
  tableQuery: TTableQuery,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): TTableQuery {
  return getRelationalAdapter(tableQuery).wrap(tableQuery, rule, options);
}

/** Wrap unscoped relational roots just enough to reject unsafe nested scoped includes. */
export function createRelationalWithGuard<TTableQuery extends RelationalTableQuery>(
  tableQuery: TTableQuery,
  queryName: string,
): TTableQuery {
  return new Proxy(tableQuery, {
    get(target, prop, receiver) {
      if (prop === "findFirst" || prop === "findMany") {
        return wrapWithGuard(bindRelationalMethod(target, prop), queryName);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapWithGuard<TResult>(
  originalMethod: RelationalMethod<unknown, TResult>,
  queryName: string,
): RelationalMethod<unknown, TResult> {
  return (config) => {
    assertNoRelationalWith(config, queryName);
    return originalMethod(config);
  };
}

function getRelationalAdapter(tableQuery: object): RelationalQueryAdapter {
  return RELATIONAL_ADAPTERS.find((candidate) =>
    candidate.supports(tableQuery),
  ) as RelationalQueryAdapter;
}
