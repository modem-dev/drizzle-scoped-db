import { eq } from "drizzle-orm";

import { getRuleForTable, normalizeOptions } from "../../src/internal/options";
import type { ScopedTableRule } from "../../src/types";
import { projectsTbl, scopeByColumn, tasksTbl, type Column } from "./fixtures";

describe("scope table rule helpers", () => {
  it("detects scope columns in conflict targets by identity, arrays, and column names", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId);

    expect(rule.hasScopeInConflictTarget?.(projectsTbl.workspaceId)).toBe(true);
    expect(rule.hasScopeInConflictTarget?.([projectsTbl.id, projectsTbl.workspaceId])).toBe(true);
    expect(rule.hasScopeInConflictTarget?.({ name: "workspace_id" })).toBe(true);
    expect(rule.hasScopeInConflictTarget?.({ name: "id" })).toBe(false);
    expect(rule.hasScopeInConflictTarget?.({ columnName: "workspace_id" })).toBe(false);
    expect(rule.hasScopeInConflictTarget?.(null)).toBe(false);
    expect(rule.hasScopeInConflictTarget?.("workspace_id")).toBe(false);
  });

  it("requires an inferable column name unless columnName is provided", () => {
    const malformedColumn = {} as Column;

    expect(() => scopeByColumn(projectsTbl, malformedColumn)).toThrow(
      "Unable to infer Drizzle column name. Pass `columnName` to scopeByColumn().",
    );

    const rule = scopeByColumn(projectsTbl, malformedColumn, { columnName: "workspace_id" });
    expect(rule.hasScopeInConflictTarget?.({ name: "workspace_id" })).toBe(true);
  });

  it("delegates where predicate detection to the inferred column name", () => {
    const rule = scopeByColumn(projectsTbl, projectsTbl.workspaceId);

    expect(rule.hasScopeInWhere?.(eq(projectsTbl.workspaceId, "workspace-1"))).toBe(true);
    expect(rule.hasScopeInWhere?.(eq(projectsTbl.id, "project-1"))).toBe(false);
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
