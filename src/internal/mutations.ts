import type { SQL } from "drizzle-orm";

import type { ScopedTable, ScopedTableRule } from "../types.js";
import type { DrizzleLikeDb, NormalizedCreateScopedDbOptions } from "./options.js";
import {
  assertWhereAllowed,
  createInvalidInsertError,
  createInvalidUpdateError,
  getRuleTableName,
  scopeCondition,
} from "./scope.js";

/** Create an insert builder that validates scoped values. */
export function createScopedInsertBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
) {
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

      return insertBuilder.values(valuesOrArray);
    },
  };
}

/** Create an update builder that injects scoped predicates into where clauses. */
export function createScopedUpdateBuilder<TScope, TTable extends ScopedTable>(
  db: object,
  table: TTable,
  rule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
) {
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
) {
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

/** Wrap a mutation result in a thenable facade that hides scope-unsafe builder methods. */
function createScopedMutationResult(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle mutation results are dialect-specific.
  rawResult: any,
): {
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
} {
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- Mutation results act as thenables for direct awaits.
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(rawResult).then(onfulfilled, onrejected);
    },
  };
}
