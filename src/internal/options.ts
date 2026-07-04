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
  transaction: <T>(callback: (tx: any) => T | Promise<T>) => T | Promise<T>;
  // oxlint-disable-next-line typescript/no-explicit-any -- Execute arguments are driver-specific.
  execute?: (...args: any[]) => unknown;
};

/** Normalized options with defaults applied once per wrapper tree. */
type RuleIndexes<TScope> = {
  rulesByTable: WeakMap<object, ScopedTableRule<TScope>>;
  rulesByOriginalTableName: Map<string, ScopedTableRule<TScope>>;
  rulesByQueryName: Map<string, ScopedTableRule<TScope>>;
};

const ORIGINAL_TABLE_NAME = Symbol.for("drizzle:OriginalName");
const IS_ALIAS = Symbol.for("drizzle:IsAlias");

type CachedRuleIndexes = {
  rulesSnapshot: readonly ScopedTableRule<unknown>[];
  indexes: RuleIndexes<unknown>;
};

// Index construction is hot for apps that create one scoped wrapper per request. Cache by rules-array
// identity, but keep a shallow snapshot so mutating a reused rules array cannot leave newly added or
// replaced scoped rules invisible. Do not replace this with an unconditional cache lookup unless
// rules arrays are made immutable at the API boundary.
const ruleIndexCache = new WeakMap<ScopedTableRule<unknown>[], CachedRuleIndexes>();

export type NormalizedCreateScopedDbOptions<
  TScope,
  TExtensions extends Record<string, unknown> = {},
  TUnscopedDbPropertyName extends string = string,
  TScopeValuePropertyName extends string | undefined = string | undefined,
> = Required<
  Pick<
    CreateScopedDbOptions<TScope, TExtensions, TUnscopedDbPropertyName, TScopeValuePropertyName>,
    "unscopedDbPropertyName"
  >
> &
  Omit<
    CreateScopedDbOptions<TScope, TExtensions, TUnscopedDbPropertyName, TScopeValuePropertyName>,
    "unscopedDbPropertyName"
  > &
  RuleIndexes<TScope>;

/** Normalize options and precompute rule lookup maps. */
export function normalizeOptions<
  TScope,
  TExtensions extends Record<string, unknown>,
  TUnscopedDbPropertyName extends string,
  TScopeValuePropertyName extends string | undefined,
>(
  options: CreateScopedDbOptions<
    TScope,
    TExtensions,
    TUnscopedDbPropertyName,
    TScopeValuePropertyName
  >,
): NormalizedCreateScopedDbOptions<
  TScope,
  TExtensions,
  TUnscopedDbPropertyName,
  TScopeValuePropertyName
> {
  const ruleIndexes = getRuleIndexes(options.rules);

  return {
    ...options,
    unscopedDbPropertyName: options.unscopedDbPropertyName ?? "_unsafeUnscopedDb",
    ...ruleIndexes,
  } as NormalizedCreateScopedDbOptions<
    TScope,
    TExtensions,
    TUnscopedDbPropertyName,
    TScopeValuePropertyName
  >;
}

/** Build or reuse rule lookup indexes for the current rules array contents. */
function getRuleIndexes<TScope>(rules: ScopedTableRule<TScope>[]): RuleIndexes<TScope> {
  const cacheKey = rules as ScopedTableRule<unknown>[];
  const cached = ruleIndexCache.get(cacheKey);
  if (cached && rulesMatchSnapshot(cacheKey, cached.rulesSnapshot)) {
    return cached.indexes as RuleIndexes<TScope>;
  }

  const rulesByTable = new WeakMap<object, ScopedTableRule<TScope>>();
  const rulesByOriginalTableName = new Map<string, ScopedTableRule<TScope>>();
  const rulesByQueryName = new Map<string, ScopedTableRule<TScope>>();

  for (const rule of rules) {
    rulesByTable.set(rule.table, rule);
    const originalTableName = getOriginalTableName(rule.table);
    if (originalTableName) {
      rulesByOriginalTableName.set(originalTableName, rule);
    }
    if (rule.queryName) {
      rulesByQueryName.set(rule.queryName, rule);
    }
  }

  const indexes = { rulesByTable, rulesByOriginalTableName, rulesByQueryName };
  ruleIndexCache.set(cacheKey, {
    rulesSnapshot: [...cacheKey],
    indexes: indexes as RuleIndexes<unknown>,
  });
  return indexes;
}

function rulesMatchSnapshot(
  rules: readonly ScopedTableRule<unknown>[],
  snapshot: readonly ScopedTableRule<unknown>[],
): boolean {
  return rules.length === snapshot.length && rules.every((rule, index) => rule === snapshot[index]);
}

/** Look up exact table rules and fail closed for aliases of scoped tables. */
export function getRuleForTable<TScope>(
  table: object,
  options: NormalizedCreateScopedDbOptions<TScope>,
): ScopedTableRule<TScope> | undefined {
  const exactRule = options.rulesByTable.get(table);
  if (exactRule) {
    return exactRule;
  }

  const originalTableName = getOriginalTableName(table);
  if (
    isAlias(table) &&
    originalTableName &&
    options.rulesByOriginalTableName.has(originalTableName)
  ) {
    throw new Error(
      `Aliased scoped table "${originalTableName}" is not supported unless the alias has its own explicit scoped rule.`,
    );
  }

  return undefined;
}

function getOriginalTableName(table: object): string | undefined {
  const originalTableName = (table as Record<symbol, unknown>)[ORIGINAL_TABLE_NAME];
  return typeof originalTableName === "string" ? originalTableName : undefined;
}

function isAlias(table: object): boolean {
  return (table as Record<symbol, unknown>)[IS_ALIAS] === true;
}
