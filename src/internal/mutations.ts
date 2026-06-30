import { and, type SQL } from "drizzle-orm";

import type {
  ScopedDeleteBuilder,
  ScopedInsertBuilder,
  ScopedMutationResult,
  ScopedTable,
  ScopedTableRule,
  ScopedUpdateBuilder,
} from "../types.js";
import type { DrizzleLikeDb, NormalizedCreateScopedDbOptions } from "./options.js";
import {
  assertWhereAllowed,
  createInvalidConflictTargetError,
  createInvalidInsertError,
  createInvalidUpdateError,
  getRuleTableName,
  scopeCondition,
} from "./scope.js";

/**
 * Wrap the raw dialect insert result so the scoped facade can expose `$unsafeUnscoped()` — a local
 * escape that returns the raw builder (already carrying the scoped values) for conflict/upsert
 * chaining. Safe dialect methods are validated before forwarding; other terminal methods delegate to
 * the raw builder, keeping the result awaitable and preserving `.returning(...)` / `.$returningId()`.
 */
function wrapScopedInsertResult<TScope, TTable extends ScopedTable, TResult extends object>(
  raw: TResult,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): TResult {
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        return null;
      },
      get(_target, property) {
        if (property === "$unsafeUnscoped") {
          return () => raw;
        }
        if (isUnsafeObjectPrototypeProperty(property)) {
          return undefined;
        }

        const value = Reflect.get(raw, property, raw);
        if (property === "$dynamic" && typeof value === "function") {
          return () => {
            throw createInvalidConflictTargetError(getRuleTableName(rule), options);
          };
        }

        if (property === "returning" && typeof value === "function") {
          return (...args: unknown[]) =>
            wrapScopedInsertResult(value.apply(raw, args) as TResult, rule, options);
        }

        if (property === "onConflictDoUpdate" && typeof value === "function") {
          return (config: unknown) => {
            const configRecord = assertScopedConflictUpdateAllowed(config, rule, options);
            const scopeGuard = rule.where(options.scopeValue);
            if (!scopeGuard) {
              throw createInvalidConflictTargetError(getRuleTableName(rule), options);
            }
            const { where: legacyWhere, ...configWithoutLegacyWhere } = configRecord;
            const callerSetWhere =
              configRecord.setWhere && legacyWhere
                ? and(legacyWhere as SQL, configRecord.setWhere as SQL)
                : ((configRecord.setWhere ?? legacyWhere) as SQL | undefined);
            const setWhere = callerSetWhere ? and(callerSetWhere, scopeGuard) : scopeGuard;
            const guardedConfig = { ...configWithoutLegacyWhere, setWhere };
            return wrapScopedInsertResult(value.call(raw, guardedConfig), rule, options);
          };
        }

        if (property === "onConflictDoNothing" && typeof value === "function") {
          return (...args: unknown[]) =>
            wrapScopedInsertResult(value.apply(raw, args), rule, options);
        }

        if (property === "onDuplicateKeyUpdate" && typeof value === "function") {
          return () => {
            throw createInvalidConflictTargetError(getRuleTableName(rule), options);
          };
        }

        return typeof value === "function" ? value.bind(raw) : value;
      },
    },
  ) as TResult;
}

function isUnsafeObjectPrototypeProperty(property: string | symbol): boolean {
  return (
    property === "__proto__" ||
    property === "constructor" ||
    property === "valueOf" ||
    property === "__defineGetter__" ||
    property === "__defineSetter__" ||
    property === "__lookupGetter__" ||
    property === "__lookupSetter__"
  );
}

function assertScopedConflictUpdateAllowed<TScope, TTable extends ScopedTable>(
  config: unknown,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): Record<string, unknown> & { set?: unknown; setWhere?: unknown } {
  const tableName = getRuleTableName(rule);
  const configRecord = config as (Record<string, unknown> & { set?: unknown }) | null;
  if (!configRecord || typeof configRecord !== "object") {
    throw createInvalidConflictTargetError(tableName, options);
  }

  if (!rule.validateInsert || !rule.validateUpdate) {
    throw createInvalidConflictTargetError(tableName, options);
  }

  const set = configRecord.set;
  const setRecord = set as Record<string, unknown>;
  if (!set || typeof set !== "object" || !rule.validateUpdate(setRecord, options.scopeValue)) {
    throw createInvalidUpdateError(tableName, (set ?? {}) as Record<string, unknown>, options);
  }

  return configRecord;
}

/** Create an insert builder that validates scoped values. */
export function createScopedInsertBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedInsertBuilder {
  const dbRecord = db as DrizzleLikeDb;
  const insertBuilder = dbRecord.insert(table);

  return {
    values(valuesOrArray: Record<string, unknown> | Record<string, unknown>[]) {
      const valuesArray = Array.isArray(valuesOrArray) ? valuesOrArray : [valuesOrArray];

      if (rule.validateInsert) {
        for (const row of valuesArray) {
          if (!rule.validateInsert(row, options.scopeValue)) {
            throw createInvalidInsertError(getRuleTableName(rule), row, options);
          }
        }
      }

      return wrapScopedInsertResult(insertBuilder.values(valuesOrArray), rule, options);
    },
  };
}

/** Create an update builder that injects scoped predicates into where clauses. */
export function createScopedUpdateBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedUpdateBuilder {
  const dbRecord = db as DrizzleLikeDb;
  const updateBuilder = dbRecord.update(table);

  return {
    set(values: Record<string, unknown>) {
      if (rule.validateUpdate) {
        if (!rule.validateUpdate(values, options.scopeValue)) {
          throw createInvalidUpdateError(getRuleTableName(rule), values, options);
        }
      }
      const setBuilder = updateBuilder.set(values);

      return {
        where(condition: SQL | undefined) {
          assertWhereAllowed(condition, rule, options);
          const rawResult = setBuilder.where(scopeCondition(condition, rule, options));
          return createScopedMutationResult(rawResult);
        },
      };
    },
  };
}

/** Create a delete builder that injects scoped predicates into where clauses. */
export function createScopedDeleteBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedDeleteBuilder {
  const dbRecord = db as DrizzleLikeDb;
  const deleteBuilder = dbRecord.delete(table);

  return {
    where(condition: SQL | undefined) {
      assertWhereAllowed(condition, rule, options);
      const rawResult = deleteBuilder.where(scopeCondition(condition, rule, options));
      return createScopedMutationResult(rawResult);
    },
  };
}

/** Wrap a mutation result with the scoped facade type while preserving dialect terminal methods. */
function createScopedMutationResult<TRaw>(rawResult: TRaw): ScopedMutationResult<TRaw> {
  if (!rawResult || typeof rawResult !== "object") {
    return rawResult as ScopedMutationResult<TRaw>;
  }

  return new Proxy(
    {},
    {
      getPrototypeOf() {
        return null;
      },
      get(_target, property) {
        if (property === "where" || property === "$dynamic") {
          return () => {
            throw new Error("Scoped mutation results do not expose raw query-builder chaining.");
          };
        }
        if (isUnsafeObjectPrototypeProperty(property)) {
          return undefined;
        }

        const value = Reflect.get(rawResult as object, property, rawResult);
        if (property === "returning" && typeof value === "function") {
          return (...args: unknown[]) => createScopedMutationResult(value.apply(rawResult, args));
        }

        return typeof value === "function" ? value.bind(rawResult) : value;
      },
    },
  ) as ScopedMutationResult<TRaw>;
}
