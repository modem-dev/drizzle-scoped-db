export { assertDrizzleCompatibility, containsColumnFilter } from "./drizzle-compat.js";
export {
  InvalidScopedInsertError,
  InvalidScopedUpdateError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
} from "./errors.js";
export { defineScopedTable, scopeByColumn } from "./rules.js";
export { createScopedDb } from "./scoped-db.js";
export type {
  CreateScopedDbOptions,
  InferSelection,
  RelationalWhere,
  RelationalWhereCallback,
  ScopedDb,
  ScopedDbErrors,
  ScopedDeleteBuilder,
  ScopedInsertBuilder,
  ScopedInsertResult,
  ScopedMutationResult,
  ScopedQueryBuilder,
  ScopedSelectBuilder,
  ScopedTable,
  ScopedTableRule,
  ScopedUpdateBuilder,
  ScopedWhereBuilder,
  ScopeByColumnOptions,
} from "./types.js";
