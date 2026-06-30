import type { NormalizedCreateScopedDbOptions } from "../options.js";
import type { ScopedTableRule } from "../../types.js";

export type RelationalTableQuery = { findFirst: unknown; findMany: unknown };
export type RelationalMethodName = "findFirst" | "findMany";
export type RelationalMethodConfig<TWhere> = { where?: TWhere; [key: string]: unknown };
export type RelationalMethod<TWhere, TResult> = (
  config?: RelationalMethodConfig<TWhere>,
) => Promise<TResult>;

export interface RelationalQueryAdapter {
  readonly name: string;

  supports(tableQuery: object): boolean;

  wrap<TScope, TTableQuery extends RelationalTableQuery>(
    tableQuery: TTableQuery,
    rule: ScopedTableRule<TScope>,
    options: NormalizedCreateScopedDbOptions<TScope>,
  ): TTableQuery;
}

/** Bind a Drizzle relational method while preserving its table-query receiver. */
export function bindRelationalMethod<TWhere, TResult>(
  tableQuery: RelationalTableQuery,
  methodName: RelationalMethodName,
): RelationalMethod<TWhere, TResult> {
  const method = tableQuery[methodName] as (
    this: RelationalTableQuery,
    config?: unknown,
  ) => Promise<TResult>;
  return (config) => method.call(tableQuery, config);
}
