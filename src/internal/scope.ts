import { and, getTableName as drizzleGetTableName, type SQL } from "drizzle-orm";

import {
  InvalidScopedConflictTargetError,
  InvalidScopedInsertError,
  InvalidScopedUpdateError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
} from "../errors.js";
import type { ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";

/** Validate required user-supplied SQL where shape for a scoped table. */
export function assertWhereAllowed<TScope>(
  condition: SQL | undefined,
  rule: ScopedTableRule<TScope> | undefined,
  options: NormalizedCreateScopedDbOptions<TScope>,
): void {
  if (!rule) {
    return;
  }

  if (!condition && isStrictMode(options)) {
    throw createMissingWhereError(getRuleTableName(rule), options);
  }

  if (isStrictMode(options) && !rule.hasScopeInWhere?.(condition)) {
    throw createMissingScopeError(getRuleTableName(rule), options);
  }
}

/** Strict mode is enabled by default; callers must explicitly opt out. */
export function isStrictMode<TScope>(options: NormalizedCreateScopedDbOptions<TScope>): boolean {
  return options.strict !== false;
}

/** Add a joined table's scope predicate to the join condition while preserving outer-join semantics. */
export function scopeJoinCondition<TScope>(
  condition: SQL | undefined,
  rule: ScopedTableRule<TScope> | undefined,
  options: NormalizedCreateScopedDbOptions<TScope>,
): SQL | undefined {
  const scopedPredicate = rule?.where(options.scopeValue);
  if (!scopedPredicate) {
    return condition;
  }

  return and(condition, scopedPredicate) as SQL;
}

/** Combine a user condition with one table's declared scope predicate. */
export function scopeCondition<TScope>(
  condition: SQL | undefined,
  rule: ScopedTableRule<TScope> | undefined,
  options: NormalizedCreateScopedDbOptions<TScope>,
): SQL | undefined {
  if (!rule) {
    return condition;
  }
  const scopedPredicate = rule.where(options.scopeValue);
  if (!condition) {
    return scopedPredicate;
  }
  if (!scopedPredicate) {
    return condition;
  }
  return and(condition, scopedPredicate);
}

/** Resolve a rule's table name. */
export function getRuleTableName<TScope>(rule: ScopedTableRule<TScope>): string {
  return rule.tableName ?? drizzleGetTableName(rule.table);
}

/** Create the configured missing-where error. */
export function createMissingWhereError<TScope>(
  tableName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.missingWhere?.(tableName, options.scopeName, options.scopeValue) ??
    new MissingScopedWhereError(options.scopeName, tableName)
  );
}

/** Create the configured missing-scope error. */
export function createMissingScopeError<TScope>(
  tableName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.missingScope?.(tableName, options.scopeName, options.scopeValue) ??
    new MissingScopedPredicateError(options.scopeName, tableName)
  );
}

/** Create the configured invalid-insert error. */
export function createInvalidInsertError<TScope>(
  tableName: string,
  row: Record<string, unknown>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.invalidInsert?.(tableName, row, options.scopeName, options.scopeValue) ??
    new InvalidScopedInsertError(options.scopeName, tableName)
  );
}

/** Create the configured invalid-update error. */
export function createInvalidUpdateError<TScope>(
  tableName: string,
  row: Record<string, unknown>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.invalidUpdate?.(tableName, row, options.scopeName, options.scopeValue) ??
    new InvalidScopedUpdateError(options.scopeName, tableName)
  );
}

/** Create the configured invalid-conflict-target error. */
export function createInvalidConflictTargetError<TScope>(
  tableName: string,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Error {
  return (
    options.errors?.invalidConflictTarget?.(tableName, options.scopeName, options.scopeValue) ??
    new InvalidScopedConflictTargetError(options.scopeName, tableName)
  );
}
