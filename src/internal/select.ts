import type { SQL, Table, TableConfig } from "drizzle-orm";

import type {
  InferSelection,
  ScopedQueryBuilder,
  ScopedSelectBuilder,
  ScopedTable,
  ScopedTableRule,
  ScopedWhereBuilder,
} from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
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
      const fromBuilder = selectBuilder.from(table);
      const rule = options.rulesByTable.get(table);

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

    leftJoin<TJoinTable extends Table<TableConfig>>(joinTable: TJoinTable, on: SQL) {
      const joinRule = options.rulesByTable.get(joinTable);
      return createScopedFromBuilder(
        builder.leftJoin(joinTable, scopeJoinCondition(on, joinRule, options)),
        rootRule,
        options,
      );
    },

    innerJoin<TJoinTable extends Table<TableConfig>>(joinTable: TJoinTable, on: SQL) {
      const joinRule = options.rulesByTable.get(joinTable);
      return createScopedFromBuilder(
        builder.innerJoin(joinTable, scopeJoinCondition(on, joinRule, options)),
        rootRule,
        options,
      );
    },

    // oxlint-disable-next-line unicorn/no-thenable -- Query builders intentionally act as thenables to catch direct awaits.
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      assertWhereAllowed(undefined, rootRule, options);
      const cond = scopeCondition(undefined, rootRule, options);
      const query = cond ? builder.where(cond) : builder;
      return Promise.resolve(query).then(onfulfilled, onrejected);
    },
  };
}

/** Build a scoped where-builder facade that prevents double-.where() scope overwrite. */
function createScopedWhereBuilder<TResult>(
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle builder internals are intentionally opaque.
  rawBuilder: any,
): ScopedWhereBuilder<TResult> {
  const promise = Promise.resolve(rawBuilder) as Promise<TResult>;
  const facade = {
    limit(n: number): ScopedWhereBuilder<TResult> {
      return createScopedWhereBuilder<TResult>(rawBuilder.limit(n));
    },
    offset(n: number): ScopedWhereBuilder<TResult> {
      return createScopedWhereBuilder<TResult>(rawBuilder.offset(n));
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
    orderBy(...columns: any[]): ScopedWhereBuilder<TResult> {
      return createScopedWhereBuilder<TResult>(rawBuilder.orderBy(...columns));
    },
  };
  return Object.assign(promise, facade) as ScopedWhereBuilder<TResult>;
}
