import type { CreateScopedDbOptions, ScopedTableRule } from "../types.js";

/** Minimal Drizzle-like surface used internally by the wrapper. */
export type DrizzleLikeDb = {
  query?: Record<PropertyKey, unknown>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and selection-specific.
  select: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and selection-specific.
  selectDistinct: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and selection-specific.
  selectDistinctOn?: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and table-specific.
  insert: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and table-specific.
  update: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Drizzle method overloads are dialect- and table-specific.
  delete: (...args: any[]) => any;
  // oxlint-disable-next-line typescript/no-explicit-any -- Transaction callback receives driver-specific transaction types.
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Execute arguments are driver-specific.
  execute?: (...args: any[]) => unknown;
};

/** Normalized options with defaults applied once per wrapper tree. */
type RuleIndexes<TScope> = {
  rulesByTable: WeakMap<object, ScopedTableRule<TScope>>;
  rulesByQueryName: Map<string, ScopedTableRule<TScope>>;
};

export type NormalizedCreateScopedDbOptions<TScope> = Required<
  Pick<CreateScopedDbOptions<TScope>, "unscopedDbPropertyName">
> &
  Omit<CreateScopedDbOptions<TScope>, "unscopedDbPropertyName"> &
  RuleIndexes<TScope>;

const ruleIndexCache = new WeakMap<ScopedTableRule<unknown>[], RuleIndexes<unknown>>();

/** Normalize options and precompute rule lookup maps. */
export function normalizeOptions<TScope>(
  options: CreateScopedDbOptions<TScope>,
): NormalizedCreateScopedDbOptions<TScope> {
  const ruleIndexes = getRuleIndexes(options.rules);

  return {
    ...options,
    unscopedDbPropertyName: options.unscopedDbPropertyName ?? "_unsafeUnscopedDb",
    ...ruleIndexes,
  };
}

/** Build rule lookup indexes once for stable rule arrays so cached scoped DBs do not duplicate them per scope value. */
function getRuleIndexes<TScope>(rules: ScopedTableRule<TScope>[]): RuleIndexes<TScope> {
  const cacheKey = rules as ScopedTableRule<unknown>[];
  const cached = ruleIndexCache.get(cacheKey);
  if (cached) {
    return cached as RuleIndexes<TScope>;
  }

  const rulesByTable = new WeakMap<object, ScopedTableRule<TScope>>();
  const rulesByQueryName = new Map<string, ScopedTableRule<TScope>>();

  for (const rule of rules) {
    rulesByTable.set(rule.table, rule);
    if (rule.queryName) {
      rulesByQueryName.set(rule.queryName, rule);
    }
  }

  const ruleIndexes = { rulesByTable, rulesByQueryName };
  ruleIndexCache.set(cacheKey, ruleIndexes as RuleIndexes<unknown>);
  return ruleIndexes;
}
