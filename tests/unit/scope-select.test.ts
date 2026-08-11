import { isNotNull, ne, sql } from "drizzle-orm";

import {
  and,
  eq,
  containsColumnFilter,
  createScopedDb,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  scopeByColumn,
  scopeByPredicate,
  projectsTbl,
  tasksTbl,
  usersTbl,
  createFakeDb,
  type SQL,
} from "./fixtures";

describe("createScopedDb select guardrails", () => {
  it("injects a declared scope predicate without requiring callers to mention the scope column when strict mode is disabled", () => {
    const rawDb = createFakeDb();
    const rules = [
      scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" }),
    ];
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules,
    });
    createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-2",
      strict: false,
      rules,
    });

    scopedDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1"));

    expect(scopedDb._unsafeUnscopedDb).toBe(rawDb);
    expect(rawDb._state.selectCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.selectCondition, "id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
  });

  it("allows scoped select execution without a caller where clause by injecting only the scope predicate", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    await (scopedDb.select().from(projectsTbl) as unknown as Promise<unknown>);

    expect(rawDb._state.selectCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.selectCondition, "id")).toBe(false);
  });

  it("starts the underlying thenable before a subsequently queued modifier", async () => {
    const { query, rawBuilder, rawThen } = createThenableSelectHarness();
    let rawThenCallsBeforeModifier: number | undefined;
    let limitedQuery: typeof query | undefined;

    queueMicrotask(() => {
      rawThenCallsBeforeModifier = rawThen.mock.calls.length;
      limitedQuery = query.limit(1);
    });

    await expect(query).resolves.toEqual([{ id: "project-1" }]);
    expect(rawThenCallsBeforeModifier).toBe(1);
    expect(rawBuilder.limit).toHaveBeenCalledOnce();
    expect(limitedQuery).toBeDefined();
    await expect(limitedQuery).resolves.toEqual([{ id: "project-1" }]);
  });

  it("rejects when the underlying thenable throws synchronously", async () => {
    const { query, rawThen } = createThenableSelectHarness();
    const error = new Error("query execution failed");
    rawThen.mockImplementationOnce(() => {
      throw error;
    });

    await expect(query).rejects.toBe(error);
  });

  it("throws when a scoped select is executed without where because strict mode is the default", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const query = scopedDb.select().from(projectsTbl) as unknown as PromiseLike<unknown>;
    expect(() => query.then(() => undefined)).toThrow(MissingScopedWhereError);
  });

  it("throws the missing-where error on direct await without where when strict mode is enabled", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const query = scopedDb.select().from(projectsTbl) as unknown as PromiseLike<unknown>;
    expect(() => query.then(() => undefined)).toThrow(MissingScopedWhereError);
  });

  it("requires the caller where clause to include the declared scope column by default", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1")),
    ).toThrow(MissingScopedPredicateError);

    expect(() =>
      scopedDb.select().from(projectsTbl).where(eq(projectsTbl.workspaceId, "workspace-1")),
    ).not.toThrow();
  });

  it("treats strict SQL predicate validation as a syntactic scope-column mention", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const misleadingPredicates = [
      ne(projectsTbl.workspaceId, "workspace-1"),
      isNotNull(projectsTbl.workspaceId),
      sql`${projectsTbl.workspaceId}`,
    ];

    for (const predicate of misleadingPredicates) {
      scopedDb.select().from(projectsTbl).where(predicate);

      expect(rawDb._state.selectCondition).toBeDefined();
      expect(countColumnReferences(rawDb._state.selectCondition, "workspace_id")).toBe(2);
    }
  });

  it("injects scope predicates for joined tables with declared rules", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId),
        scopeByColumn(tasksTbl, tasksTbl.taskWorkspaceId),
      ],
    });

    scopedDb
      .select()
      .from(projectsTbl)
      .leftJoin(tasksTbl, eq(tasksTbl.projectId, projectsTbl.id))
      .where(and(eq(projectsTbl.id, "project-1"), eq(projectsTbl.workspaceId, "workspace-1")));

    expect(rawDb._state.selectCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.selectCondition, "task_workspace_id")).toBe(false);
    expect(rawDb._state.joinConditions).toHaveLength(1);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "project_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "task_workspace_id")).toBe(true);
  });

  it("injects joined table predicates into every matching join condition", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId),
        scopeByColumn(tasksTbl, tasksTbl.taskWorkspaceId),
      ],
    });

    scopedDb
      .select()
      .from(projectsTbl)
      .leftJoin(tasksTbl, eq(tasksTbl.projectId, projectsTbl.id))
      .innerJoin(tasksTbl, eq(tasksTbl.id, projectsTbl.id))
      .where(eq(projectsTbl.id, "project-1"));

    expect(rawDb._state.joinConditions).toHaveLength(2);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "task_workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[1], "task_workspace_id")).toBe(true);
  });

  it("fails closed when a joined table rule produces no predicate", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId),
        scopeByPredicate(tasksTbl, {
          where: () => undefined,
          strictColumns: [tasksTbl.taskWorkspaceId],
        }),
      ],
    });

    expect(() =>
      scopedDb
        .select()
        .from(projectsTbl)
        .leftJoin(tasksTbl, eq(tasksTbl.projectId, projectsTbl.id)),
    ).toThrow('Scoped rule for table "tasks" did not produce a scope predicate.');

    expect(rawDb._state.joinConditions).toBeUndefined();
  });

  it("injects scope predicates for joined tables even when the root table is unscoped", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    // usersTbl is unscoped (root table), projectsTbl is scoped (joined table)
    await (scopedDb
      .select()
      .from(usersTbl)
      .leftJoin(projectsTbl, eq(projectsTbl.id, usersTbl.id))
      .where(eq(usersTbl.id, "user-1")) as unknown as Promise<unknown>);

    expect(rawDb._state.selectCondition).toBeDefined();
    // The root table (usersTbl) has no rule, so workspace_id should not be in the where clause
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(false);
    expect(containsColumnFilter(rawDb._state.selectCondition, "id")).toBe(true);

    // The joined table (projectsTbl) has a rule, so workspace_id should be in the join condition
    expect(rawDb._state.joinConditions).toHaveLength(1);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "workspace_id")).toBe(true);
  });

  it("allows direct await on unscoped root table select without where", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    await (scopedDb.select().from(usersTbl) as unknown as Promise<unknown>);
    expect(rawDb._state.selectCondition).toBeUndefined();
  });

  it("covers selected-column distinct builders and join wrappers", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    scopedDb
      .select({ id: projectsTbl.id })
      .from(projectsTbl)
      .leftJoin(usersTbl, eq(usersTbl.id, projectsTbl.id))
      .where(eq(projectsTbl.id, "p1"));
    scopedDb
      .selectDistinct({ id: projectsTbl.id })
      .from(projectsTbl)
      .innerJoin(usersTbl, eq(usersTbl.id, projectsTbl.id))
      .where(eq(projectsTbl.id, "p2"));
    scopedDb.selectDistinct().from(projectsTbl).where(eq(projectsTbl.id, "p3"));
    scopedDb
      .selectDistinctOn([projectsTbl.id], { id: projectsTbl.id })
      .from(projectsTbl)
      .where(eq(projectsTbl.id, "p4"));
    scopedDb.selectDistinctOn([projectsTbl.id]).from(projectsTbl).where(eq(projectsTbl.id, "p5"));

    expect(rawDb._state.selectCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
  });

  it("throws on explicit undefined where clauses when strict mode is enabled", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    expect(() => scopedDb.select().from(projectsTbl).where(undefined)).toThrow(
      MissingScopedWhereError,
    );
  });

  it("prevents double .where() from overwriting the injected scope predicate", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const result = scopedDb
      .select()
      .from(projectsTbl)
      .where(eq(projectsTbl.id, "project-1")) as unknown as {
      where: (condition: SQL | undefined) => unknown;
    };

    // A second .where() must not be callable — Drizzle overwrites (not ANDs),
    // so allowing it would silently drop the injected scope predicate.
    expect(() => result.where(eq(projectsTbl.id, "project-2"))).toThrow();

    // Scope predicate was injected and not overwritten.
    expect(rawDb._state.selectCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.selectCondition, "id")).toBe(true);
  });

  it("preserves scope predicate through select terminal-method chaining", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const havingCondition = eq(projectsTbl.name, "Roadmap");
    const result = scopedDb
      .select()
      .from(projectsTbl)
      .where(eq(projectsTbl.id, "project-1"))
      .limit(10)
      .offset(5)
      .orderBy(projectsTbl.id)
      .groupBy(projectsTbl.id)
      .having(havingCondition) as unknown as {
      where: (condition: SQL | undefined) => unknown;
    };

    // .where() still not reachable after chaining terminal methods.
    expect(() => result.where(eq(projectsTbl.id, "project-2"))).toThrow();
    expect(rawDb._state.selectCondition).toBeDefined();
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(true);
    expect(rawDb._state.groupByColumns).toEqual([projectsTbl.id]);
    expect(rawDb._state.havingCondition).toBe(havingCondition);
  });
});

function createThenableSelectHarness() {
  type Row = { id: string };
  type RawBuilder = Promise<Row[]> & { limit(n: number): RawBuilder };
  let rawBuilder: RawBuilder;
  rawBuilder = Object.assign(Promise.resolve([{ id: "project-1" }]), {
    limit: vi.fn(() => rawBuilder),
  });
  const rawThen = vi.spyOn(rawBuilder, "then");
  const rawDb = {
    select() {
      return {
        from() {
          return {
            where() {
              return rawBuilder;
            },
          };
        },
      };
    },
  } as unknown as ReturnType<typeof createFakeDb>;
  const scopedDb = createScopedDb(rawDb, {
    scopeName: "workspace",
    scopeValue: "workspace-1",
    strict: false,
    rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
  });
  const query = scopedDb
    .select({ id: projectsTbl.id })
    .from(projectsTbl)
    .where(eq(projectsTbl.workspaceId, "workspace-1"));

  return { query, rawBuilder, rawThen };
}

function countColumnReferences(condition: SQL | undefined, columnName: string): number {
  const chunks = (condition as { queryChunks?: unknown[] } | undefined)?.queryChunks;
  return Array.isArray(chunks) ? countColumnReferencesInChunks(chunks, columnName) : 0;
}

function countColumnReferencesInChunks(chunks: unknown[], columnName: string): number {
  let count = 0;

  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") {
      continue;
    }

    if ("name" in chunk && chunk.name === columnName) {
      count += 1;
    }

    if ("queryChunks" in chunk && Array.isArray(chunk.queryChunks)) {
      count += countColumnReferencesInChunks(chunk.queryChunks, columnName);
    }
  }

  return count;
}
