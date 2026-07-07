import { defineScopedTable } from "../../src/rules";

import {
  and,
  eq,
  containsColumnFilter,
  createScopedDb,
  InvalidScopedUpdateError,
  MissingScopedPredicateError,
  scopeByColumn,
  scopeByPredicate,
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
        scopeByColumn(projectsTbl, {
          workspaceId: projectsTbl.workspaceId,
          regionId: projectsTbl.regionId,
        }),
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

  it("derives composite column injection, validation, and strict detection from one rule", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace-region",
      scopeValue: { workspaceId: "workspace-1", regionId: "us" },
      strict: true,
      rules: [
        scopeByColumn(projectsTbl, {
          workspaceId: projectsTbl.workspaceId,
          regionId: projectsTbl.regionId,
        }),
      ],
    });

    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.workspaceId, "workspace-1")),
    ).toThrow(MissingScopedPredicateError);

    scopedDb
      .select()
      .from(projectsTbl)
      .where(and(eq(projectsTbl.workspaceId, "workspace-1"), eq(projectsTbl.regionId, "us")));
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.selectCondition, "region_id")).toBe(true);

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", regionId: "us", name: "Roadmap" });
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ regionId: "eu" })
        .where(and(eq(projectsTbl.workspaceId, "workspace-1"), eq(projectsTbl.regionId, "us"))),
    ).toThrow(InvalidScopedUpdateError);
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
        scopeByPredicate(projectsTbl, {
          where: () => undefined,
          strictColumns: [projectsTbl.workspaceId],
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
