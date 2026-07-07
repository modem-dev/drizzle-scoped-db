import { and, eq } from "drizzle-orm";

import { getRuleForTable, normalizeOptions } from "../../src/internal/options";
import type { ScopedTableRule } from "../../src/types";
import { projectsTbl, scopeByColumn, scopeByPredicate, tasksTbl, type Column } from "./fixtures";

describe("scope table rule helpers", () => {
  it("requires an inferable column name unless columnName is provided", () => {
    const malformedColumn = {} as Column;

    expect(() => scopeByColumn(projectsTbl, malformedColumn)).toThrow(
      "Unable to infer Drizzle column name for scopeByColumn()",
    );

    const rule = scopeByColumn(projectsTbl, malformedColumn, { columnName: "workspace_id" });
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(true);
  });

  it("delegates where predicate detection to the inferred column name", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId);

    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(true);
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.id, "project-1"))).toBe(false);
  });

  it("infers insert and update validation keys from single-column table properties", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId);

    expect(rule.validateInsert?.({ workspaceId: "workspace-1" }, "workspace-1")).toBe(true);
    expect(rule.validateInsert?.({ workspaceId: "workspace-2" }, "workspace-1")).toBe(false);
    expect(rule.validateUpdate?.({ workspaceId: "workspace-1" }, "workspace-1")).toBe(true);
    expect(rule.validateUpdate?.({ workspaceId: "workspace-2" }, "workspace-1")).toBe(false);
    expect(rule.validateUpdate?.({ name: "Roadmap" }, "workspace-1")).toBe(true);
  });

  it("allows inferred single-column mutation validation to be disabled", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId, {
      insertKey: false,
      updateKey: false,
    });

    expect(rule.validateInsert).toBeUndefined();
    expect(rule.validateUpdate).toBeUndefined();
  });

  it("creates composite column rules from one declaration", () => {
    const rule = scopeByColumn<{ workspaceId: string; regionId: string }, typeof projectsTbl>(
      projectsTbl,
      {
        workspaceId: projectsTbl.workspaceId,
        region: {
          column: projectsTbl.regionId,
          value: (scope: { regionId: string }) => scope.regionId.toUpperCase(),
          insertKey: false,
          updateKey: "regionId",
          equals: (left, right) => String(left).toUpperCase() === right,
        },
        name: {
          column: projectsTbl.name,
          value: () => "Roadmap",
          updateKey: false,
        },
      },
      { queryName: "projects", tableName: "Project" },
    );

    expect(rule.queryName).toBe("projects");
    expect(rule.tableName).toBe("Project");
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(false);
    expect(
      rule.hasScopeInWhere?.(
        and(
          eq(projectsTbl.workspaceId, "workspace-1"),
          eq(projectsTbl.regionId, "US"),
          eq(projectsTbl.name, "Roadmap"),
        ),
      ),
    ).toBe(true);
    expect(
      rule.validateInsert?.(
        { workspaceId: "workspace-1", regionId: "ignored", name: "Roadmap" },
        { workspaceId: "workspace-1", regionId: "us" },
      ),
    ).toBe(true);
    expect(
      rule.validateUpdate?.({ regionId: "us" }, { workspaceId: "workspace-1", regionId: "us" }),
    ).toBe(true);
    expect(
      rule.validateUpdate?.({ regionId: "eu" }, { workspaceId: "workspace-1", regionId: "us" }),
    ).toBe(false);
    expect(
      rule.validateUpdate?.({ name: "Renamed" }, { workspaceId: "workspace-1", regionId: "us" }),
    ).toBe(true);
  });

  it("throws when a column map's default resolver receives a primitive scope value", () => {
    const primitiveScopeRule = scopeByColumn<string, typeof projectsTbl>(projectsTbl, {
      workspaceId: projectsTbl.workspaceId,
    });

    expect(() =>
      primitiveScopeRule.validateInsert?.({ workspaceId: "workspace-1" }, "workspace-1"),
    ).toThrow('scopeByColumn() column map "workspaceId" needs an object scope value');
    expect(() => primitiveScopeRule.where("workspace-1")).toThrow(
      "needs an object scope value to resolve, but received string",
    );

    const explicitResolverRule = scopeByColumn<string, typeof projectsTbl>(projectsTbl, {
      workspaceId: { column: projectsTbl.workspaceId, value: (scope) => scope },
    });
    expect(
      explicitResolverRule.validateInsert?.({ workspaceId: "workspace-1" }, "workspace-1"),
    ).toBe(true);
  });

  it("creates predicate rules with strict column detection", () => {
    const rule = scopeByPredicate(
      projectsTbl,
      {
        where: () => eq(projectsTbl.workspaceId, "workspace-1"),
        strictColumns: [projectsTbl.workspaceId],
      },
      { queryName: "projects", tableName: "Project" },
    );

    expect(rule.queryName).toBe("projects");
    expect(rule.tableName).toBe("Project");
    expect(rule.where("ignored")).toBeDefined();
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(true);
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.id, "project-1"))).toBe(false);
    expect(() =>
      scopeByPredicate(projectsTbl, {
        where: () => eq(projectsTbl.workspaceId, "workspace-1"),
        strictColumns: [],
      }),
    ).toThrow("strict predicate validation requires at least one column.");
    expect(() =>
      scopeByPredicate(projectsTbl, {
        where: () => eq(projectsTbl.workspaceId, "workspace-1"),
        strictColumns: [{} as Column],
      }),
    ).toThrow("Unable to infer Drizzle column name for scopeByPredicate() strictColumns");
    expect(() => scopeByPredicate(projectsTbl, [])).toThrow(
      "scopeByPredicate() requires at least one predicate.",
    );
  });

  it("combines multiple predicate rules", () => {
    const rule = scopeByPredicate(projectsTbl, [
      {
        where: () => eq(projectsTbl.workspaceId, "workspace-1"),
        strictColumns: [projectsTbl.workspaceId],
      },
      { where: () => eq(projectsTbl.regionId, "us"), strictColumns: [projectsTbl.regionId] },
    ]);

    expect(rule.where("ignored")).toBeDefined();
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(false);
    expect(
      rule.hasScopeInWhere?.(
        and(eq(projectsTbl.workspaceId, "workspace-1"), eq(projectsTbl.regionId, "us")),
      ),
    ).toBe(true);
  });

  it("omits composite RQBv2 support when keys cannot resolve", () => {
    const rule = scopeByColumn({} as typeof projectsTbl, {
      workspaceId: { column: { name: "workspace_id" } as Column },
    });
    expect(rule.relational).toBeUndefined();
  });

  it("adds RQBv2 object-filter helpers when the column key can be resolved", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId);

    expect(rule.relational?.rqbV2?.where("workspace-1")).toEqual({ workspaceId: "workspace-1" });
    expect(rule.relational?.rqbV2?.hasScopeInWhere?.({ workspaceId: "workspace-1" })).toBe(true);
    expect(rule.relational?.rqbV2?.hasScopeInWhere?.({ workspaceId: undefined })).toBe(false);
    expect(rule.relational?.rqbV2?.hasScopeInWhere?.({ id: "project-1" })).toBe(false);
    expect(rule.relational?.rqbV2?.hasScopeInWhere?.(undefined)).toBe(false);
    expect(
      rule.relational?.rqbV2?.hasScopeInWhere?.({
        OR: [{ id: "project-1" }, { AND: [{ workspaceId: "workspace-1" }] }],
      }),
    ).toBe(true);
    expect(rule.relational?.rqbV2?.hasScopeInWhere?.({ NOT: { workspaceId: "workspace-2" } })).toBe(
      true,
    );
  });

  it("omits RQBv2 helpers when the column key cannot be resolved", () => {
    const tableWithoutColumns = {} as typeof projectsTbl;
    expect(
      scopeByColumn(tableWithoutColumns, { name: "workspace_id" } as Column, {
        columnName: "workspace_id",
      }).relational?.rqbV2,
    ).toBeUndefined();

    expect(
      scopeByColumn(projectsTbl, { name: "missing_scope" } as Column, {
        columnName: "missing_scope",
      }).relational?.rqbV2,
    ).toBeUndefined();
  });
});

const originalTableNameSymbol = Symbol.for("drizzle:OriginalName");

describe("scoped rule indexing", () => {
  it("indexes rules for table objects without Drizzle original table names", () => {
    const table = {} as ScopedTableRule<string>["table"];
    const rule: ScopedTableRule<string> = {
      table,
      where: () => eq(projectsTbl.workspaceId, "workspace-1"),
    };

    const options = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [rule],
    });

    expect(getRuleForTable(table, options)).toBe(rule);
  });

  it("rebuilds indexes from mutated rules arrays instead of reusing stale indexes", () => {
    const originalProjectsRule = scopeByColumn(projectsTbl, projectsTbl.workspaceId);
    const rules: ScopedTableRule<unknown>[] = [originalProjectsRule];

    normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules,
    });
    rules.push(scopeByColumn(tasksTbl, tasksTbl.taskWorkspaceId, { queryName: "tasks" }));

    const optionsAfterPush = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules,
    });

    expect(getRuleForTable(tasksTbl, optionsAfterPush)).toBe(rules[1]);
    expect(optionsAfterPush.rulesByQueryName.get("tasks")).toBe(rules[1]);

    const replacementProjectsRule = scopeByColumn(projectsTbl, projectsTbl.workspaceId, {
      queryName: "projects",
    });
    rules[0] = replacementProjectsRule;

    const optionsAfterReplacement = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules,
    });

    expect(getRuleForTable(projectsTbl, optionsAfterReplacement)).toBe(replacementProjectsRule);
    expect(optionsAfterReplacement.rulesByQueryName.get("projects")).toBe(replacementProjectsRule);
  });

  it("treats non-string Drizzle original table names as absent", () => {
    const rule = {
      table: projectsTbl,
      where: () => eq(projectsTbl.workspaceId, "workspace-1"),
    } satisfies ScopedTableRule<string>;
    const options = normalizeOptions({
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [rule],
    });
    const malformedTable = { [originalTableNameSymbol]: 123 };

    expect(getRuleForTable(malformedTable, options)).toBeUndefined();
  });
});
