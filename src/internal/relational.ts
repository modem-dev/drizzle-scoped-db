import type { ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
import { type RelationalQueryAdapter, type RelationalTableQuery } from "./relational/adapter.js";
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

function getRelationalAdapter(tableQuery: object): RelationalQueryAdapter {
  return RELATIONAL_ADAPTERS.find((candidate) =>
    candidate.supports(tableQuery),
  ) as RelationalQueryAdapter;
}
