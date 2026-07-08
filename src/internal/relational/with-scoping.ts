import { and, type SQL } from "drizzle-orm";

import { getRuleForTable, type NormalizedCreateScopedDbOptions } from "../options.js";
import { requireScopePredicate } from "../scope.js";
import type { RelationalRelations, RelationalSchemaResolver } from "./schema.js";

type WithConfig = Record<string, unknown>;

const DRIZZLE_TABLE_NAME = Symbol.for("drizzle:Name");

/** RQBv1 nested relation `where` is a callback, a raw SQL condition, or absent. */
type NestedWhereCallback = (fields: unknown, operators: Record<string, unknown>) => SQL | undefined;

/**
 * Return a copy of a relational query config whose nested `with` includes each carry their scoped
 * table's predicate. Configs without a `with` are returned unchanged. Fails closed when a nested
 * relation cannot be resolved to a table, so an unresolvable include can never load unscoped rows.
 */
export function scopeRelationalWith<TScope>(
  config: Record<string, unknown> | undefined,
  parentRelations: RelationalRelations | undefined,
  schema: RelationalSchemaResolver,
  options: NormalizedCreateScopedDbOptions<TScope>,
  parentTableName: string,
): Record<string, unknown> | undefined {
  if (!config || config.with == null || typeof config.with !== "object") {
    return config;
  }

  return {
    ...config,
    with: scopeWith(config.with as WithConfig, parentRelations, schema, options, parentTableName),
  };
}

function scopeWith<TScope>(
  withConfig: WithConfig,
  parentRelations: RelationalRelations | undefined,
  schema: RelationalSchemaResolver,
  options: NormalizedCreateScopedDbOptions<TScope>,
  parentTableName: string,
): WithConfig {
  if (!parentRelations) {
    throw new Error(
      `Scoped relational query cannot resolve relations for table "${parentTableName}", so nested \`with\` includes cannot be scoped safely.`,
    );
  }

  const scoped: WithConfig = {};
  for (const [relationKey, relationConfig] of Object.entries(withConfig)) {
    // `with: { rel: false }` explicitly excludes the relation, so there is nothing to scope.
    if (relationConfig === false) {
      scoped[relationKey] = relationConfig;
      continue;
    }

    const referencedTable = parentRelations[relationKey]?.referencedTable;
    if (!referencedTable) {
      throw new Error(
        `Scoped relational query cannot resolve nested relation "${relationKey}" on table "${parentTableName}", so it cannot be scoped safely.`,
      );
    }

    // getRuleForTable throws for aliases of scoped tables, preserving the fail-closed alias contract.
    const rule = getRuleForTable(referencedTable, options);
    const normalized: Record<string, unknown> =
      relationConfig == null || relationConfig === true
        ? {}
        : { ...(relationConfig as Record<string, unknown>) };

    if (rule) {
      normalized.where = combineNestedWhere(normalized.where, requireScopePredicate(rule, options));
    }

    if (normalized.with != null && typeof normalized.with === "object") {
      normalized.with = scopeWith(
        normalized.with as WithConfig,
        schema.relationsForTable(referencedTable),
        schema,
        options,
        tableLabel(referencedTable, relationKey),
      );
    }

    scoped[relationKey] = normalized;
  }

  return scoped;
}

/** AND the injected scope predicate into any caller-supplied nested `where` (callback or raw SQL). */
function combineNestedWhere(existing: unknown, predicate: SQL): NestedWhereCallback | SQL {
  if (existing == null) {
    return predicate;
  }

  if (typeof existing === "function") {
    const callerWhere = existing as NestedWhereCallback;
    return (fields, operators) => {
      const userCondition = callerWhere(fields, operators);
      return userCondition ? (and(userCondition, predicate) as SQL) : predicate;
    };
  }

  return and(existing as SQL, predicate) as SQL;
}

function tableLabel(table: object, fallback: string): string {
  const name = (table as Record<symbol, unknown>)[DRIZZLE_TABLE_NAME];
  return typeof name === "string" ? name : fallback;
}
