import type { Column } from "drizzle-orm";

import type { ScopedTableRule } from "../../types.js";
import { createRqbV2ColumnObjectFilter } from "./rqb-v2-object-filter.js";

/** Build optional relational-query support for a column-scoped rule. */
export function createColumnRelationalSupport<TScope>(
  table: object,
  column: Column,
  columnName: string,
): ScopedTableRule<TScope>["relational"] {
  const rqbV2 = createRqbV2ColumnObjectFilter<TScope>(table, column, columnName);
  return rqbV2 ? { rqbV2 } : undefined;
}
