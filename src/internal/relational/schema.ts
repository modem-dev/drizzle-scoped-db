/** One relation entry from Drizzle's relational config: only the referenced table is needed to scope it. */
export type RelationalRelation = { referencedTable?: object };
export type RelationalRelations = Record<string, RelationalRelation>;

/**
 * Resolves Drizzle's relational metadata so nested `with` includes can be scoped. Relations are
 * looked up either by the `db.query` key (Drizzle `tsName`) for the query root, or by the referenced
 * table object when recursing into deeper includes.
 */
export interface RelationalSchemaResolver {
  relationsForTsName(tsName: string): RelationalRelations | undefined;
  relationsForTable(table: object): RelationalRelations | undefined;
}

// The relational config object is stable per db instance, so resolvers are cached by its identity to
// avoid re-scanning the schema every time a scoped wrapper is created (apps often create one per request).
const resolverCache = new WeakMap<object, RelationalSchemaResolver>();

/**
 * Build a relational-metadata resolver from a Drizzle db handle, or `undefined` when the handle does
 * not expose relational config (no schema/relations were registered). Relational includes fail closed
 * when no resolver is available.
 */
export function createRelationalSchemaResolver(db: unknown): RelationalSchemaResolver | undefined {
  const schema = (db as { _?: { schema?: Record<string, unknown> } } | undefined)?._?.schema;
  if (!schema || typeof schema !== "object") {
    return undefined;
  }

  const cached = resolverCache.get(schema);
  if (cached) {
    return cached;
  }

  const byTsName = new Map<string, RelationalRelations>();
  const byTable = new Map<object, RelationalRelations>();

  for (const [tsName, config] of Object.entries(schema)) {
    const relations = extractRelations(config);
    byTsName.set(tsName, relations);
    const table = extractTable(config);
    if (table) {
      byTable.set(table, relations);
    }
  }

  const resolver: RelationalSchemaResolver = {
    relationsForTsName: (tsName) => byTsName.get(tsName),
    relationsForTable: (table) => byTable.get(table),
  };
  resolverCache.set(schema, resolver);
  return resolver;
}

function extractRelations(config: unknown): RelationalRelations {
  const relations = (config as { relations?: unknown } | undefined)?.relations;
  return relations && typeof relations === "object" ? (relations as RelationalRelations) : {};
}

/** Recover a table config's table object through one of its columns, which each hold a `.table` back-reference. */
function extractTable(config: unknown): object | undefined {
  const columns = (config as { columns?: Record<string, unknown> } | undefined)?.columns;
  if (!columns || typeof columns !== "object") {
    return undefined;
  }
  for (const column of Object.values(columns)) {
    const table = (column as { table?: unknown } | undefined)?.table;
    if (table && typeof table === "object") {
      return table;
    }
  }
  return undefined;
}
