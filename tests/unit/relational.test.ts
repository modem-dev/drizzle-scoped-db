import {
  eq,
  containsColumnFilter,
  createScopedDb,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  defineScopedTable,
  scopeByColumn,
  projectsTbl,
  createFakeDb,
} from "./fixtures";

const entityKind = Symbol.for("drizzle:entityKind");

class FakeRqbV2TableQuery {
  static [entityKind] = "PgRelationalQueryBuilderV2";

  private readonly state: { relationalObjectWhere?: unknown };

  constructor(state: { relationalObjectWhere?: unknown }) {
    this.state = state;
  }

  async findFirst(config?: { where?: Record<string, unknown> }) {
    this.state.relationalObjectWhere = config?.where;
    return { where: config?.where };
  }

  async findMany(config?: { where?: Record<string, unknown> }) {
    this.state.relationalObjectWhere = config?.where;
    return [{ where: config?.where }];
  }
}

describe("createScopedDb relational query guardrails", () => {
  it("wraps relational query methods when a rule declares the query property name", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    await scopedDb.query.projects.findFirst({
      where: (project, { eq }) => eq(project.id, "project-1"),
    });

    expect(rawDb._state.relationalCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.relationalCondition, "id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.relationalCondition, "workspace_id")).toBe(true);
  });

  it("leaves unscoped relational query methods usable while rejecting nested includes", async () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    await expect(scopedDb.query.users.findMany({ limit: 5 })).resolves.toEqual([
      { config: { limit: 5 } },
    ]);
    await expect(scopedDb.query.users.findFirst({ limit: 1 })).resolves.toEqual({
      config: { limit: 1 },
    });
    expect(scopedDb.query.users.label).toBe("users table query");
    expect(() => scopedDb.query.users.findMany({ with: { projects: true } })).toThrow(
      "does not support nested `with` relations",
    );
  });

  it("leaves relational queries unchanged when no relational query rules are configured", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    expect(scopedDb.query.projects).toBe(rawDb.query.projects);
  });

  it("guards relational table queries without a matching query-name rule against nested includes", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "otherProjects" })],
    });

    const condition = eq(projectsTbl.id, "p1");
    await expect(scopedDb.query.projects.findMany({ where: condition })).resolves.toEqual([
      { condition },
    ]);
    expect(() =>
      scopedDb.query.projects.findMany({
        where: eq(projectsTbl.id, "p1"),
        with: { tasks: true },
      } as never),
    ).toThrow("does not support nested `with` relations");
  });

  it("supports relational findMany, direct SQL where clauses, caching, and pass-through query properties", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    await scopedDb.query.projects.findMany({ where: eq(projectsTbl.id, "project-1") });

    expect(containsColumnFilter(rawDb._state.relationalCondition, "id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.relationalCondition, "workspace_id")).toBe(true);
    expect(scopedDb.query.projects).toBe(scopedDb.query.projects);
    expect((scopedDb.query as Record<PropertyKey, unknown>)[Symbol.toStringTag]).toBeUndefined();
    expect((scopedDb.query as Record<string, unknown>).metadata).toBe("unwrapped metadata");
    expect((scopedDb.query as Record<string, unknown>).incomplete).toBe(rawDb.query.incomplete);
    expect(() =>
      scopedDb.query.projects.findMany({
        where: eq(projectsTbl.id, "project-1"),
        with: { tasks: true },
      } as never),
    ).toThrow("does not support nested `with` relations");
  });

  it("enforces strict where validation on relational queries", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    expect(() => scopedDb.query.projects.findMany()).toThrow(MissingScopedWhereError);
    await expect(
      scopedDb.query.projects.findMany({ where: eq(projectsTbl.id, "p1") }),
    ).rejects.toThrow(MissingScopedPredicateError);
    await expect(scopedDb.query.projects.findFirst({ where: () => undefined })).rejects.toThrow(
      MissingScopedWhereError,
    );

    await scopedDb.query.projects.findMany({ where: eq(projectsTbl.workspaceId, "workspace-1") });
    expect(containsColumnFilter(rawDb._state.relationalCondition, "workspace_id")).toBe(true);
  });

  it("throws on relational queries without where when strict mode is enabled", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    expect(() => scopedDb.query.projects.findFirst()).toThrow(MissingScopedWhereError);
  });

  it("uses an explicit RQBv2 adapter for relational object filters", async () => {
    const state: { relationalObjectWhere?: unknown } = {};
    const rawDb = {
      ...createFakeDb(),
      query: { projects: new FakeRqbV2TableQuery(state) },
    };
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    await scopedDb.query.projects.findFirst();
    expect(state.relationalObjectWhere).toEqual({ workspaceId: "workspace-1" });

    await scopedDb.query.projects.findMany({ where: { id: "project-1" } });
    expect(state.relationalObjectWhere).toEqual({
      AND: [{ id: "project-1" }, { workspaceId: "workspace-1" }],
    });
  });

  it("enforces strict RQBv2 object-filter scope validation before injection", async () => {
    const state: { relationalObjectWhere?: unknown } = {};
    const rawDb = {
      ...createFakeDb(),
      query: { projects: new FakeRqbV2TableQuery(state) },
    };
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    expect(() => scopedDb.query.projects.findMany()).toThrow(MissingScopedWhereError);
    expect(() => scopedDb.query.projects.findMany({ where: { id: "project-1" } })).toThrow(
      MissingScopedPredicateError,
    );

    await scopedDb.query.projects.findMany({
      where: { AND: [{ id: "project-1" }, { workspaceId: "workspace-1" }] },
    });
    expect(state.relationalObjectWhere).toEqual({
      AND: [
        { AND: [{ id: "project-1" }, { workspaceId: "workspace-1" }] },
        { workspaceId: "workspace-1" },
      ],
    });
  });

  it("rejects RQBv2 callback/SQL where shapes and custom rules without object-filter support", async () => {
    const state: { relationalObjectWhere?: unknown } = {};
    const rawDb = {
      ...createFakeDb(),
      query: { projects: new FakeRqbV2TableQuery(state) },
    };
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    expect(() =>
      scopedDb.query.projects.findMany({
        where: { workspaceId: "workspace-1" },
        with: { tasks: true },
      } as never),
    ).toThrow("does not support nested `with` relations");
    expect(() => scopedDb.query.projects.findMany({ where: null as never })).toThrow(
      "Unsupported RQBv2 relational where",
    );
    expect(() => scopedDb.query.projects.findMany({ where: [] as never })).toThrow(
      "Unsupported RQBv2 relational where",
    );
    expect(() => scopedDb.query.projects.findMany({ where: (() => ({})) as never })).toThrow(
      "Unsupported RQBv2 relational where",
    );
    expect(() => scopedDb.query.projects.findMany({ where: { getSQL: () => undefined } })).toThrow(
      "Unsupported RQBv2 relational where",
    );
    expect(() =>
      scopedDb.query.projects.findMany({
        where: eq(projectsTbl.workspaceId, "workspace-1") as never,
      }),
    ).toThrow("Unsupported RQBv2 relational where");

    const scopedCustomDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        defineScopedTable(projectsTbl, {
          queryName: "projects",
          where: () => eq(projectsTbl.workspaceId, "workspace-1"),
        }),
      ],
    });

    expect(() => scopedCustomDb.query.projects.findMany({ where: { id: "project-1" } })).toThrow(
      "does not declare a relational object-filter scope",
    );
  });
});
