import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { normalizeOptions, type NormalizedCreateScopedDbOptions } from "../../src/internal/options";
import { createRelationalSchemaResolver } from "../../src/internal/relational/schema";
import { scopeRelationalWith } from "../../src/internal/relational/with-scoping";
import { scopeByColumn } from "../../src/rules";

const scopedTasks = pgTable("scoped_tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
});

function options(): NormalizedCreateScopedDbOptions<string> {
  return normalizeOptions({ scopeName: "workspace", scopeValue: "workspace-1", rules: [] });
}

describe("createRelationalSchemaResolver", () => {
  it("returns undefined when the db exposes no relational schema", () => {
    expect(createRelationalSchemaResolver(undefined)).toBeUndefined();
    expect(createRelationalSchemaResolver({})).toBeUndefined();
    expect(createRelationalSchemaResolver({ _: {} })).toBeUndefined();
    // A non-object schema is treated as absent rather than scanned.
    expect(createRelationalSchemaResolver({ _: { schema: "not-an-object" } })).toBeUndefined();
  });

  it("reuses the same resolver for a given schema object", () => {
    const db = { _: { schema: { t1: { columns: {}, relations: {} } } } };
    expect(createRelationalSchemaResolver(db)).toBe(createRelationalSchemaResolver(db));
  });

  it("skips table configs that do not expose a resolvable table object", () => {
    const resolver = createRelationalSchemaResolver({
      _: {
        schema: {
          noColumns: { relations: {} },
          nullColumns: { columns: null },
          columnsWithoutTable: { columns: { id: { name: "id" } } },
        },
      },
    });

    // Relations are still resolvable by tsName even when the table object cannot be recovered.
    expect(resolver?.relationsForTsName("noColumns")).toEqual({});
    // A config whose relations field is absent yields an empty relation set.
    expect(resolver?.relationsForTsName("nullColumns")).toEqual({});
    // No column carried a `.table` back-reference, so the table cannot be looked up by object.
    expect(resolver?.relationsForTable({})).toBeUndefined();
  });
});

describe("scopeRelationalWith", () => {
  const passthroughResolver = {
    relationsForTsName: () => undefined,
    relationsForTable: () => undefined,
  };

  it("returns the config unchanged when there is no `with`", () => {
    const config = { where: () => undefined };
    expect(scopeRelationalWith(config, {}, passthroughResolver, options(), "root")).toBe(config);
  });

  it("fails closed when the parent table's relations cannot be resolved", () => {
    expect(() =>
      scopeRelationalWith(
        { with: { tasks: true } },
        undefined,
        passthroughResolver,
        options(),
        "projects",
      ),
    ).toThrow('cannot resolve relations for table "projects"');
  });

  it("recurses into nested includes even when a referenced table is not a Drizzle table", () => {
    const midTable = { kind: "not-a-drizzle-table" };
    const leafTable = { kind: "leaf" };
    const resolver = {
      relationsForTsName: () => undefined,
      relationsForTable: (table: object) =>
        table === midTable ? { deeper: { referencedTable: leafTable } } : undefined,
    };

    const scoped = scopeRelationalWith(
      { with: { mid: { with: { deeper: true } } } },
      { mid: { referencedTable: midTable } },
      resolver,
      options(),
      "root",
    ) as { with: { mid: { with: Record<string, unknown> } } };

    // No rules are declared, so nothing is injected; the include tree is preserved and traversed.
    expect(scoped.with.mid.with.deeper).toEqual({});
  });

  it("falls back to the injected predicate when a caller nested where returns undefined", () => {
    const rule = scopeByColumn(scopedTasks, scopedTasks.workspaceId);
    const scopedOptions = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [rule],
    });

    const scoped = scopeRelationalWith(
      { with: { tasks: { where: () => undefined } } },
      { tasks: { referencedTable: scopedTasks } },
      passthroughResolver,
      scopedOptions,
      "root",
    ) as { with: { tasks: { where: (fields: unknown, operators: unknown) => unknown } } };

    // The composed nested where ANDs the injected scope with the caller predicate; when the caller
    // returns undefined it must still emit the scope predicate rather than dropping it.
    const composed = scoped.with.tasks.where({}, {});
    expect(composed).toBeDefined();
    expect(composed).toHaveProperty("queryChunks");
  });
});
