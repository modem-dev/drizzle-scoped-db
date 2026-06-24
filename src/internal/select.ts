import type { Column, SQL, Table, TableConfig } from "drizzle-orm";

import type { ScopedTable, ScopedTableRule } from "../types.js";
import type { NormalizedCreateScopedDbOptions } from "./options.js";
import { assertWhereAllowed, scopeCondition, scopeJoinCondition } from "./scope.js";

/** Type helper to infer selected values from a Drizzle selection object. */
type InferSelection<T> = {
  [K in keyof T]: T[K] extends Column<infer Config> ? Config["data"] : never;
};

/** Query builder returned after selecting from a scoped table. */
interface ScopedQueryBuilder<
  TTable extends ScopedTable,
  TResult = NonNullable<TTable["$inferSelect"]>[],
> {
  where(condition: SQL | undefined): ScopedWhereBuilder<TResult>;
  leftJoin<TJoinTable extends Table<TableConfig>>(
    table: TJoinTable,
    on: SQL,
  ): ScopedQueryBuilder<TTable, TResult>;
  innerJoin<TJoinTable extends Table<TableConfig>>(
    table: TJoinTable,
    on: SQL,
  ): ScopedQueryBuilder<TTable, TResult>;
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

/** Query builder returned after `.where(...)` is called. */
interface ScopedWhereBuilder<TResult> extends Promise<TResult> {
  limit(n: number): ScopedWhereBuilder<TResult>;
  offset(n: number): ScopedWhereBuilder<TResult>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle accepts PgColumn | SQL | SQL.Aliased.
  orderBy(...columns: any[]): ScopedWhereBuilder<TResult>;
}

/** Select builder facade that scopes only tables with matching rules. */
interface ScopedSelectBuilder<TSelection = undefined> {
  from<TTable extends ScopedTable>(
    table: TTable,
  ): ScopedQueryBuilder<
    TTable,
    TSelection extends undefined
      ? NonNullable<TTable["$inferSelect"]>[]
      : InferSelection<TSelection>[]
  >;
}

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

      if (!rule) {
        return fromBuilder;
      }

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
  rootRule: ScopedTableRule<TScope, TTable>,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedQueryBuilder<TTable, TResult> {
  return {
    where(condition: SQL | undefined): ScopedWhereBuilder<TResult> {
      assertWhereAllowed(condition, rootRule, options);
      return builder.where(
        scopeCondition(condition, rootRule, options),
      ) as ScopedWhereBuilder<TResult>;
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
      return Promise.resolve(builder.where(scopeCondition(undefined, rootRule, options))).then(
        onfulfilled,
        onrejected,
      );
    },
  };
}
