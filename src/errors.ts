/** Error thrown when scoped query execution requires a where clause but none was supplied. */
export class MissingScopedWhereError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(
      `Query on table "${tableName}" is missing a where clause required by ${scopeName} scoping.`,
    );
    this.name = "MissingScopedWhereError";
  }
}

/** Error thrown when a strict scoped query where clause does not include the declared scope. */
export class MissingScopedPredicateError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(`Query on table "${tableName}" is missing the declared ${scopeName} scope predicate.`);
    this.name = "MissingScopedPredicateError";
  }
}

/** Error thrown when a scoped insert row is missing or has a mismatched scope value. */
export class InvalidScopedInsertError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(
      `Insert on table "${tableName}" is missing or has a mismatched ${scopeName} scope value.`,
    );
    this.name = "InvalidScopedInsertError";
  }
}

/** Error thrown when a scoped update payload has a mismatched scope value. */
export class InvalidScopedUpdateError extends Error {
  constructor(scopeName: string, tableName: string) {
    super(`Update on table "${tableName}" has a mismatched ${scopeName} scope value.`);
    this.name = "InvalidScopedUpdateError";
  }
}
