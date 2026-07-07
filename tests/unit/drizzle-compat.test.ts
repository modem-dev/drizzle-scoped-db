import {
  aliasedTable,
  eq,
  assertDrizzleCompatibility,
  containsColumnFilter,
  createScopedDb,
  MissingScopedPredicateError,
  scopeByColumn,
  projectsTbl,
  projectsAuditTbl,
  createFakeDb,
  type Column,
  type SQL,
} from "./fixtures";

describe("Drizzle compatibility helpers", () => {
  it("asserts Drizzle SQL chunk compatibility for strict validation", () => {
    expect(() =>
      assertDrizzleCompatibility(eq(projectsTbl.workspaceId, "workspace-1"), "workspace_id"),
    ).not.toThrow();
    expect(() => assertDrizzleCompatibility({} as SQL, "workspace_id")).toThrow("workspace_id");
    expect(() =>
      assertDrizzleCompatibility(eq(projectsTbl.id, "project-1"), "workspace_id"),
    ).toThrow("workspace_id");
  });

  it("returns false for missing or non-Drizzle SQL chunks and searches nested chunk arrays", () => {
    expect(containsColumnFilter(undefined, "workspace_id")).toBe(false);
    expect(containsColumnFilter({} as SQL, "workspace_id")).toBe(false);
    expect(
      containsColumnFilter(
        {
          queryChunks: [null, "literal", { queryChunks: [{ name: "workspace_id" }] }],
        } as unknown as SQL,
        "workspace_id",
      ),
    ).toBe(true);
    expect(
      containsColumnFilter({ queryChunks: [null, "literal"] } as unknown as SQL, "workspace_id"),
    ).toBe(false);
  });

  it("allows overriding the strict-mode column name and rejects invalid columns without names", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId, { columnName: "tenant_id" });
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(false);
    expect(() => scopeByColumn(projectsTbl, {} as Column)).toThrow(
      "Unable to infer Drizzle column name for scopeByColumn()",
    );
  });

  it("rejects same-named columns that belong to a different table in strict mode", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    // projectsAuditTbl shares the "workspace_id" column name with projectsTbl.
    // Strict validation must reject this because the WHERE clause does not
    // actually filter the scoped table's column.
    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsAuditTbl.workspaceId, "workspace-1")),
    ).toThrow(MissingScopedPredicateError);

    // Filtering on the correct table's column still passes.
    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.workspaceId, "workspace-1")),
    ).not.toThrow();

    // An alias of the scoped table itself still scopes the query. Drizzle's relational query API
    // references the scoped table through an alias of the schema's TS name, so a scope filter on an
    // alias of the same underlying table must be accepted (only genuinely different tables fail).
    const parent = aliasedTable(projectsTbl, "parent");
    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(parent.workspaceId, "workspace-1")),
    ).not.toThrow();
  });

  it("rejects aliases of scoped tables unless the alias has its own explicit rule", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const parent = aliasedTable(projectsTbl, "parent");

    expect(() => scopedDb.select().from(parent).where(eq(parent.id, "p1"))).toThrow(
      "Aliased scoped table",
    );
    expect(() =>
      scopedDb.select().from(projectsTbl).leftJoin(parent, eq(parent.id, projectsTbl.regionId)),
    ).toThrow("Aliased scoped table");

    const rawDbWithAliasRule = createFakeDb();
    const scopedDbWithAliasRule = createScopedDb(rawDbWithAliasRule, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(parent, parent.workspaceId)],
    });
    scopedDbWithAliasRule.select().from(parent).where(eq(parent.id, "p1"));
    expect(
      containsColumnFilter(rawDbWithAliasRule._state.selectCondition, "workspace_id", parent),
    ).toBe(true);
  });

  it("containsColumnFilter disambiguates by table identity when a table is provided", () => {
    const projectsCondition = eq(projectsTbl.workspaceId, "workspace-1");
    const auditCondition = eq(projectsAuditTbl.workspaceId, "workspace-1");

    // Without a table, both match by name only (backward-compatible behavior).
    expect(containsColumnFilter(projectsCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(auditCondition, "workspace_id")).toBe(true);

    // With the scoped table, only the matching table's column satisfies the check.
    expect(containsColumnFilter(projectsCondition, "workspace_id", projectsTbl)).toBe(true);
    expect(containsColumnFilter(auditCondition, "workspace_id", projectsTbl)).toBe(false);
    expect(containsColumnFilter(auditCondition, "workspace_id", projectsAuditTbl)).toBe(true);

    // An alias of the scoped table (alias name `parent` differs from the SQL name, exactly as
    // Drizzle's relational query API aliases columns to a table's TS name) resolves to the same
    // underlying table identity, so it satisfies the scoped table's check. A genuinely different
    // table (projectsAuditTbl, above) still does not.
    const parent = aliasedTable(projectsTbl, "parent");
    const parentCondition = eq(parent.workspaceId, "workspace-1");
    expect(containsColumnFilter(parentCondition, "workspace_id", parent)).toBe(true);
    expect(containsColumnFilter(parentCondition, "workspace_id", projectsTbl)).toBe(true);
  });

  it("assertDrizzleCompatibility accepts an optional table for stricter checking", () => {
    expect(() =>
      assertDrizzleCompatibility(
        eq(projectsTbl.workspaceId, "workspace-1"),
        "workspace_id",
        projectsTbl,
      ),
    ).not.toThrow();
    expect(() =>
      assertDrizzleCompatibility(
        eq(projectsAuditTbl.workspaceId, "workspace-1"),
        "workspace_id",
        projectsTbl,
      ),
    ).toThrow("workspace_id");
  });
});
