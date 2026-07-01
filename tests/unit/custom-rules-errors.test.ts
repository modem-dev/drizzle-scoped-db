import {
  and,
  eq,
  containsColumnFilter,
  createScopedDb,
  defineScopedTable,
  InvalidScopedUpdateError,
  MissingScopedPredicateError,
  scopeByColumn,
  projectsTbl,
  createFakeDb,
  type SQL,
} from "./fixtures";

describe("createScopedDb custom rules and errors", () => {
  it("supports custom composite scope rules", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace-region",
      scopeValue: { workspaceId: "workspace-1", regionId: "us" },
      strict: false,
      rules: [
        defineScopedTable<{ workspaceId: string; regionId: string }, typeof projectsTbl>(
          projectsTbl,
          {
            where: (scope) =>
              and(
                eq(projectsTbl.workspaceId, scope.workspaceId),
                eq(projectsTbl.regionId, scope.regionId),
              ),
            validateInsert: (row, scope) =>
              row.workspaceId === scope.workspaceId && row.regionId === scope.regionId,
            validateUpdate: (payload, scope) =>
              (!payload.workspaceId || payload.workspaceId === scope.workspaceId) &&
              (!payload.regionId || payload.regionId === scope.regionId),
          },
        ),
      ],
    });

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", regionId: "us", name: "Roadmap" });
    expect(rawDb._state.insertValues).toEqual({
      id: "project-1",
      workspaceId: "workspace-1",
      regionId: "us",
      name: "Roadmap",
    });
    scopedDb.update(projectsTbl).set({ name: "Updated" }).where(eq(projectsTbl.id, "project-1"));
    scopedDb.delete(projectsTbl).where(eq(projectsTbl.id, "project-1"));
    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-2", workspaceId: "workspace-1", regionId: "us", name: "Backlog" })
      .onConflictDoUpdate({ target: projectsTbl.id, set: { name: "Backlog" } });
    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-3", workspaceId: "workspace-1", regionId: "us", name: "Wrong" })
        .onConflictDoUpdate({ target: projectsTbl.id, set: { regionId: "eu" } }),
    ).toThrow(InvalidScopedUpdateError);

    const conflictConfig = rawDb._state.conflictConfig as { setWhere?: SQL };
    expect(containsColumnFilter(conflictConfig.setWhere, "workspace_id")).toBe(true);
    expect(containsColumnFilter(conflictConfig.setWhere, "region_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.updateCondition, "region_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.deleteCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.deleteCondition, "region_id")).toBe(true);
  });

  it("supports custom error factories for every scoped validation error", () => {
    const customMissingWhere = new Error("custom missing where");
    const customMissingScope = new Error("custom missing scope");
    const customInvalidInsert = new Error("custom invalid insert");
    const customInvalidUpdate = new Error("custom invalid update");
    const customInvalidConflictTarget = new Error("custom invalid conflict target");
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId, {
          insertKey: "workspaceId",
          tableName: "Project",
        }),
      ],
      errors: {
        missingWhere: (tableName, scopeName, scopeValue) => {
          expect({ tableName, scopeName, scopeValue }).toEqual({
            tableName: "Project",
            scopeName: "workspace",
            scopeValue: "workspace-1",
          });
          return customMissingWhere;
        },
        missingScope: () => customMissingScope,
        invalidInsert: () => customInvalidInsert,
        invalidUpdate: () => customInvalidUpdate,
        invalidConflictTarget: () => customInvalidConflictTarget,
      },
    });

    const query = scopedDb.select().from(projectsTbl) as unknown as PromiseLike<unknown>;
    expect(() => query.then(() => undefined)).toThrow(customMissingWhere);
    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1")),
    ).toThrow(customMissingScope);
    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-2", name: "Wrong" }),
    ).toThrow(customInvalidInsert);
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ workspaceId: "workspace-2" })
        .where(eq(projectsTbl.id, "project-1")),
    ).toThrow(customInvalidUpdate);
    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
        .onConflictDoUpdate(null),
    ).toThrow(customInvalidConflictTarget);
  });

  it("throws the default missing-scope error when strict mode is enabled for a custom rule without a scope detector", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [
        defineScopedTable<string, typeof projectsTbl>(projectsTbl, {
          where: (scope) => eq(projectsTbl.workspaceId, scope),
        }),
      ],
    });

    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1")),
    ).toThrow(MissingScopedPredicateError);
  });

  it("fails closed when a scoped rule does not produce a predicate", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        defineScopedTable<string, typeof projectsTbl>(projectsTbl, {
          where: () => undefined,
        }),
      ],
    });
    const expectedError = 'Scoped rule for table "projects" did not produce a scope predicate.';

    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1")),
    ).toThrow(expectedError);
    expect(() =>
      (scopedDb.select().from(projectsTbl) as unknown as PromiseLike<unknown>).then(
        () => undefined,
      ),
    ).toThrow(expectedError);
    expect(() =>
      scopedDb.update(projectsTbl).set({ name: "Updated" }).where(eq(projectsTbl.id, "project-1")),
    ).toThrow(expectedError);
    expect(() => scopedDb.delete(projectsTbl).where(eq(projectsTbl.id, "project-1"))).toThrow(
      expectedError,
    );
    expect(rawDb._state.selectCondition).toBeUndefined();
    expect(rawDb._state.updateCondition).toBeUndefined();
    expect(rawDb._state.deleteCondition).toBeUndefined();
  });
});
