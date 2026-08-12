import type { SQL, Table, TableConfig } from "drizzle-orm";

import type {
  InferSelection,
  ScopedQueryBuilder,
  ScopedSelectBuilder,
  ScopedTable,
  ScopedTableRule,
  ScopedWhereBuilder,
} from "../types.js";
import { getRuleForTable, type NormalizedCreateScopedDbOptions } from "./options.js";
import { assertWhereAllowed, scopeCondition, scopeJoinCondition } from "./scope.js";

/** Build a scoped select/selectDistinct/selectDistinctOn facade. */
export function createScopedSelectBuilder<TScope, TSelection>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle select builders have overloaded generic shapes.
  selectBuilder: any,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedSelectBuilder<TSelection> {
  return {
    from<TTable extends ScopedTable>(
      table: TTable,
    ): ScopedQueryBuilder<
      TTable,
      TSelection extends undefined
        ? NonNullable<TTable["$inferSelect"]>[]
        : InferSelection<TSelection>[]
    > {
      const rule = getRuleForTable(table, options);
      const fromBuilder = selectBuilder.from(table);

      // oxlint-disable-next-line typescript/no-explicit-any -- Return type depends on selection and table inference.
      return createScopedFromBuilder(fromBuilder, rule, options) as any;
    },
  };
}

/** Build a scoped query builder for select queries on a protected table. */
function createScopedFromBuilder<
  TScope,
  TTable extends ScopedTable,
  TResult = NonNullable<TTable["$inferSelect"]>[],
>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle builder internals are intentionally opaque.
  builder: any,
  rootRule: ScopedTableRule<TScope, TTable> | undefined,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedQueryBuilder<TTable, TResult> {
  return {
    where(condition: SQL | undefined): ScopedWhereBuilder<TResult> {
      assertWhereAllowed(condition, rootRule, options);
      const rawBuilder = builder.where(scopeCondition(condition, rootRule, options));
      return createScopedWhereBuilder<TResult>(rawBuilder);
    },

    leftJoin<TJoinTable extends Table<TableConfig>>(joinTable: TJoinTable, on: SQL | undefined) {
      const joinRule = getRuleForTable(joinTable, options);
      return createScopedFromBuilder(
        builder.leftJoin(joinTable, scopeJoinCondition(on, joinRule, options)),
        rootRule,
        options,
      );
    },

    innerJoin<TJoinTable extends Table<TableConfig>>(joinTable: TJoinTable, on: SQL | undefined) {
      const joinRule = getRuleForTable(joinTable, options);
      return createScopedFromBuilder(
        builder.innerJoin(joinTable, scopeJoinCondition(on, joinRule, options)),
        rootRule,
        options,
      );
    },

    // oxlint-disable-next-line unicorn/no-thenable -- Query builders intentionally act as thenables to catch direct awaits.
    then<TResult1 = TResult, TResult2 = never>(
      onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      assertWhereAllowed(undefined, rootRule, options);
      const cond = scopeCondition(undefined, rootRule, options);
      const query = cond ? builder.where(cond) : builder;
      return Promise.resolve(query).then(
        onfulfilled as ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected,
      );
    },
  };
}

/** Build a scoped where-builder facade that prevents double-.where() scope overwrite. */
function createScopedWhereBuilder<TResult>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle builder internals are intentionally opaque.
  rawBuilder: any,
): ScopedWhereBuilder<TResult> {
  let currentBuilder = rawBuilder;
  let executionStarted = false;
  const execution = new Promise<TResult>((resolve, reject) => {
    let isThenable: boolean;
    try {
      isThenable = typeof rawBuilder?.then === "function";
    } catch (error) {
      executionStarted = true;
      reject(error);
      return;
    }

    if (!isThenable) {
      executionStarted = true;
      resolve(rawBuilder as TResult);
      return;
    }

    // Synchronous modifiers share this promise before Drizzle starts in the first microtask.
    queueMicrotask(() => {
      executionStarted = true;
      try {
        currentBuilder.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });

  let facade: ScopedWhereBuilder<TResult>;
  function continueWith(nextBuilder: unknown): ScopedWhereBuilder<TResult> {
    if (executionStarted) return createScopedWhereBuilder<TResult>(nextBuilder);
    currentBuilder = nextBuilder;
    return facade;
  }

  facade = Object.assign(execution, {
    limit(n: number): ScopedWhereBuilder<TResult> {
      return continueWith(currentBuilder.limit(n));
    },
    offset(n: number): ScopedWhereBuilder<TResult> {
      return continueWith(currentBuilder.offset(n));
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
    orderBy(...columns: any[]): ScopedWhereBuilder<TResult> {
      return continueWith(currentBuilder.orderBy(...columns));
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
    groupBy(...columns: any[]): ScopedWhereBuilder<TResult> {
      return continueWith(currentBuilder.groupBy(...columns));
    },
    having(condition: SQL | undefined): ScopedWhereBuilder<TResult> {
      return continueWith(currentBuilder.having(condition));
    },
  });
  return facade;
}
