import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { normalizeOptions, type NormalizedCreateScopedDbOptions } from "../../src/internal/options";
import { createRelationalWithGuard, createScopedTableQuery } from "../../src/internal/relational";
import {
  createRelationalSchemaResolver,
  type RelationalSchemaResolver,
} from "../../src/internal/relational/schema";
import { scopeRelationalWith } from "../../src/internal/relational/with-scoping";
import { scopeByColumn } from "../../src/rules";

const scopedProjects = pgTable("scoped_projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
});

const scopedTasks = pgTable("scoped_tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
});

function options(): NormalizedCreateScopedDbOptions<string> {
  return normalizeOptions({ scopeName: "workspace", scopeValue: "workspace-1", rules: [] });
}

/** A fake RQBv1 relational table query (no V2 entity kind) that records the config it receives. */
function fakeRqbV1Query() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    findFirst: async () => undefined,
    findMany: async (config: Record<string, unknown> = {}) => {
      calls.push(config);
      return [];
    },
  };
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

  it("passes `with: { rel: false }` through untouched", () => {
    const scoped = scopeRelationalWith(
      { with: { tasks: false } },
      { tasks: { referencedTable: scopedTasks } },
      passthroughResolver,
      options(),
      "root",
    ) as { with: { tasks: unknown } };
    expect(scoped.with.tasks).toBe(false);
  });

  it("ands a raw SQL nested where with the injected scope", () => {
    const scopedOptions = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(scopedTasks, scopedTasks.workspaceId)],
    });

    const scoped = scopeRelationalWith(
      { with: { tasks: { where: eq(scopedTasks.id, "task-1") } } },
      { tasks: { referencedTable: scopedTasks } },
      passthroughResolver,
      scopedOptions,
      "root",
    ) as { with: { tasks: { where: unknown } } };

    // A raw SQL nested where (not a callback) is ANDed with the injected scope into one SQL condition.
    expect(scoped.with.tasks.where).toHaveProperty("queryChunks");
  });

  it("fails closed when a nested relation key is absent from the parent's relations", () => {
    expect(() =>
      scopeRelationalWith(
        { with: { ghost: true } },
        { other: { referencedTable: scopedTasks } },
        passthroughResolver,
        options(),
        "root",
      ),
    ).toThrow('cannot resolve nested relation "ghost"');
  });

  it("ands a truthy caller nested where with the injected scope and recurses under named tables", () => {
    const scopedOptions = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(scopedTasks, scopedTasks.workspaceId)],
    });
    const leaf = { kind: "leaf" };
    const resolver: RelationalSchemaResolver = {
      relationsForTsName: () => undefined,
      relationsForTable: (table) =>
        table === scopedTasks ? { deeper: { referencedTable: leaf } } : undefined,
    };

    const scoped = scopeRelationalWith(
      {
        with: {
          tasks: {
            where: () => eq(scopedTasks.workspaceId, "workspace-1"),
            with: { deeper: true },
          },
        },
      },
      { tasks: { referencedTable: scopedTasks } },
      resolver,
      scopedOptions,
      "root",
    ) as {
      with: {
        tasks: { where: (f: unknown, o: unknown) => unknown; with: Record<string, unknown> };
      };
    };

    // Caller predicate is truthy, so it is ANDed with the injected scope rather than replaced.
    expect(scoped.with.tasks.where({}, {})).toHaveProperty("queryChunks");
    // Recursion continued into the deeper include (labelled by the named `scoped_tasks` table).
    expect(scoped.with.tasks.with.deeper).toEqual({});
  });
});

describe("RQBv1 relational adapter with-scoping", () => {
  const projectsRule = scopeByColumn(scopedProjects, scopedProjects.workspaceId, {
    queryName: "projectsTbl",
  });
  const tasksRule = scopeByColumn(scopedTasks, scopedTasks.workspaceId, { queryName: "tasksTbl" });
  const scopedOptions = normalizeOptions({
    scopeName: "workspace",
    scopeValue: "workspace-1",
    strict: false,
    rules: [projectsRule, tasksRule],
  });
  const resolver = createRelationalSchemaResolver({
    _: {
      schema: {
        projectsTbl: {
          relations: { tasks: { referencedTable: scopedTasks } },
          columns: { workspaceId: scopedProjects.workspaceId },
        },
        tasksTbl: { relations: {}, columns: { workspaceId: scopedTasks.workspaceId } },
      },
    },
  }) as RelationalSchemaResolver;

  it("injects the nested table's scope predicate into a scoped root include", async () => {
    const query = fakeRqbV1Query();
    const wrapped = createScopedTableQuery(query, projectsRule, scopedOptions, resolver);

    await wrapped.findMany({ with: { tasks: true } });

    const scopedWith = query.calls[0]?.with as { tasks?: { where?: unknown } };
    expect(scopedWith.tasks?.where).toBeDefined();
  });

  it("scopes a nested include reached from an unscoped relational root", async () => {
    const guardResolver: RelationalSchemaResolver = {
      relationsForTsName: (tsName) =>
        tsName === "notesTbl" ? { task: { referencedTable: scopedTasks } } : undefined,
      relationsForTable: () => undefined,
    };
    const query = fakeRqbV1Query();
    const guarded = createRelationalWithGuard(query, "notesTbl", scopedOptions, guardResolver);

    await guarded.findMany({ with: { task: true } });

    const scopedWith = query.calls[0]?.with as { task?: { where?: unknown } };
    expect(scopedWith.task?.where).toBeDefined();
  });
});
