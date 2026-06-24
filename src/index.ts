export { assertDrizzleCompatibility, containsColumnFilter } from "./drizzle-compat.js";
export {
  InvalidScopedInsertError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
} from "./errors.js";
export { defineScopedTable, scopeByColumn } from "./rules.js";
export { createScopedDb } from "./scoped-db.js";
export type {
  CreateScopedDbOptions,
  RelationalWhere,
  RelationalWhereCallback,
  ScopedDbErrors,
  ScopedTable,
  ScopedTableRule,
  ScopeByColumnOptions,
} from "./types.js";
