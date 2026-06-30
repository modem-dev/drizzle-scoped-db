import type { ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
import { createScopedRqbV1TableQuery } from "./relational-v1.js";
import { createScopedRqbV2TableQuery } from "./relational-v2.js";

const ENTITY_KIND = Symbol.for("drizzle:entityKind");

/** Wrap findFirst/findMany for Drizzle's relational query API. */
export function createScopedTableQuery<
  TScope,
  TTableQuery extends { findFirst: unknown; findMany: unknown },
>(
  tableQuery: TTableQuery,
  rule: ScopedTableRule<TScope>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): TTableQuery {
  return isRqbV2TableQuery(tableQuery)
    ? createScopedRqbV2TableQuery(tableQuery, rule, options)
    : createScopedRqbV1TableQuery(tableQuery, rule, options);
}

/** Drizzle 1.0 relational builders advertise RQBv2 in their entity kind. */
function isRqbV2TableQuery(tableQuery: object): boolean {
  const constructor = tableQuery.constructor as unknown as Record<symbol, unknown> | undefined;
  const entityKind = constructor?.[ENTITY_KIND];
  return typeof entityKind === "string" && entityKind.endsWith("V2");
}
