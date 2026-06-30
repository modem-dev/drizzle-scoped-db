import {
  eq,
  containsColumnFilter,
  createScopedDb,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  scopeByColumn,
  projectsTbl,
  createFakeDb,
} from "./fixtures";

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

  it("leaves unscoped relational query methods unchanged", async () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    await expect(scopedDb.query.users.findMany({ limit: 5 })).resolves.toEqual([
      { config: { limit: 5 } },
    ]);
  });

  it("passes through relational table queries when no query-name rule is declared for that table", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "otherProjects" })],
    });

    expect(scopedDb.query.projects).toBe(rawDb.query.projects);
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
});
