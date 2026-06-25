import { and, type Column, eq, or, type SQL } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import {
  assertDrizzleCompatibility,
  containsColumnFilter,
  createScopedDb,
  defineScopedTable,
  InvalidScopedInsertError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  scopeByColumn,
} from "./index";

const projectsTbl = pgTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  regionId: text("region_id"),
  name: text("name").notNull(),
});

const tasksTbl = pgTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskWorkspaceId: text("task_workspace_id").notNull(),
  title: text("title").notNull(),
});

const usersTbl = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
});

const projectsAuditTbl = pgTable("projects_audit", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
});

type FakeDbState = {
  selectCondition?: SQL;
  joinConditions?: SQL[];
  insertValues?: unknown;
  updateCondition?: SQL;
  deleteCondition?: SQL;
  relationalCondition?: SQL;
  transactionRawDb?: FakeDb;
};

type RelationalProjectWhere =
  | SQL
  | ((table: typeof projectsTbl, operators: typeof relationalOperators) => SQL | undefined);

type FakeWhereResult = {
  condition: SQL | undefined;
  limit(): FakeWhereResult;
  offset(): FakeWhereResult;
  orderBy(): FakeWhereResult;
};

type FakeFromBuilder = {
  where(condition: SQL | undefined): FakeWhereResult;
  leftJoin(table: unknown, on: SQL): FakeFromBuilder;
  innerJoin(table: unknown, on: SQL): FakeFromBuilder;
};

type FakeSelectBuilder = {
  from(table: unknown): FakeFromBuilder;
};

type FakeDb = {
  query: {
    projects: {
      findFirst(config?: {
        where?: RelationalProjectWhere;
      }): Promise<{ condition: SQL | undefined }>;
      findMany(config?: {
        where?: RelationalProjectWhere;
      }): Promise<{ condition: SQL | undefined }[]>;
    };
    users: {
      findMany(config?: { limit?: number }): Promise<{ config: { limit?: number } | undefined }[]>;
    };
    metadata: string;
    incomplete: {
      findFirst(): Promise<undefined>;
    };
  };
  select(columns?: Record<string, unknown>): FakeSelectBuilder;
  selectDistinct(columns?: Record<string, unknown>): FakeSelectBuilder;
  selectDistinctOn(onColumns: unknown[], columns?: Record<string, unknown>): FakeSelectBuilder;
  insert(table: unknown): { values(values: unknown): { values: unknown } };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: SQL | undefined): {
        condition: SQL | undefined;
        values: Record<string, unknown>;
      };
    };
  };
  delete(table: unknown): { where(condition: SQL | undefined): { condition: SQL | undefined } };
  transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T>;
  execute(): undefined;
  _state: FakeDbState;
};

/** Creates a minimal Drizzle-like DB that records the predicates passed into query builders. */
function createFakeDb(state: FakeDbState = {}): FakeDb {
  const db = {
    query: {
      projects: {
        async findFirst(config?: { where?: RelationalProjectWhere }) {
          state.relationalCondition = resolveRelationalWhere(config?.where);
          return { condition: state.relationalCondition };
        },
        async findMany(config?: { where?: RelationalProjectWhere }) {
          state.relationalCondition = resolveRelationalWhere(config?.where);
          return [{ condition: state.relationalCondition }];
        },
      },
      users: {
        async findMany(config?: { limit?: number }) {
          return [{ config }];
        },
      },
      metadata: "unwrapped metadata",
      incomplete: {
        async findFirst() {
          return undefined;
        },
      },
    },
    select(_columns?: Record<string, unknown>) {
      return createSelectBuilder(state);
    },
    selectDistinct(_columns?: Record<string, unknown>) {
      return createSelectBuilder(state);
    },
    selectDistinctOn(_onColumns: unknown[], _columns?: Record<string, unknown>) {
      return createSelectBuilder(this._state);
    },
    insert(_table: unknown) {
      return {
        values(values: unknown) {
          state.insertValues = values;
          return { values };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: SQL | undefined) {
              state.updateCondition = condition;
              return { condition, values };
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        where(condition: SQL | undefined) {
          state.deleteCondition = condition;
          return { condition };
        },
      };
    },
    async transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> {
      const tx = createFakeDb(state);
      state.transactionRawDb = tx;
      return callback(tx);
    },
    execute() {
      return undefined;
    },
    _state: state,
  };

  return db;
}

const relationalOperators = { and, eq, or };

/** Resolve the where shape that Drizzle relational queries accept. */
function resolveRelationalWhere(
  where:
    | SQL
    | ((table: typeof projectsTbl, operators: typeof relationalOperators) => SQL | undefined)
    | undefined,
): SQL | undefined {
  return typeof where === "function" ? where(projectsTbl, relationalOperators) : where;
}

/** Creates a minimal select builder with join and where methods. */
function createSelectBuilder(state: FakeDbState): FakeSelectBuilder {
  return {
    from(_table: unknown) {
      return createFromBuilder(state);
    },
  };
}

/** Creates a minimal from builder that records the final where predicate. */
function createFromBuilder(state: FakeDbState): FakeFromBuilder {
  const builder = {
    where(condition: SQL | undefined) {
      state.selectCondition = condition;
      return {
        condition,
        limit(): FakeWhereResult {
          return this;
        },
        offset(): FakeWhereResult {
          return this;
        },
        orderBy(): FakeWhereResult {
          return this;
        },
      };
    },
    leftJoin(_table: unknown, on: SQL): FakeFromBuilder {
      state.joinConditions = [...(state.joinConditions ?? []), on];
      return builder;
    },
    innerJoin(_table: unknown, on: SQL): FakeFromBuilder {
      state.joinConditions = [...(state.joinConditions ?? []), on];
      return builder;
    },
  };

  return builder;
}

describe("createScopedDb", () => {
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

    expect((scopedDb as FakeDb & { _unsafeUnscopedDb: FakeDb })._unsafeUnscopedDb).toBe(rawDb);
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

  it("validates insert rows when an insert key is declared", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" });

    expect(rawDb._state.insertValues).toEqual({
      id: "project-1",
      workspaceId: "workspace-1",
      name: "Roadmap",
    });
    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-2", workspaceId: "workspace-2", name: "Wrong" }),
    ).toThrow(InvalidScopedInsertError);
  });

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
          },
        ),
      ],
    });

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", regionId: "us", name: "Roadmap" });
    scopedDb.update(projectsTbl).set({ name: "Updated" }).where(eq(projectsTbl.id, "project-1"));
    scopedDb.delete(projectsTbl).where(eq(projectsTbl.id, "project-1"));

    expect(rawDb._state.insertValues).toEqual({
      id: "project-1",
      workspaceId: "workspace-1",
      regionId: "us",
      name: "Roadmap",
    });
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.updateCondition, "region_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.deleteCondition, "workspace_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.deleteCondition, "region_id")).toBe(true);
  });

  it("preserves custom unscoped DB access, custom scope value properties, extensions, and transaction wrapping", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      unscopedDbPropertyName: "_raw",
      scopeValueProperty: "_workspaceId",
      toJSON: (scopeValue) => ({ scopeValue }),
      extensions: (scopeValue) => ({
        assertWorkspaceId: (expected: string) => expect(scopeValue).toBe(expected),
      }),
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    }) as FakeDb & {
      _raw: FakeDb;
      _workspaceId: string;
      toJSON(): { scopeValue: string };
      assertWorkspaceId(expected: string): void;
    };

    expect(scopedDb._raw).toBe(rawDb);
    expect(scopedDb._workspaceId).toBe("workspace-1");
    expect(scopedDb.toJSON()).toEqual({ scopeValue: "workspace-1" });
    scopedDb.assertWorkspaceId("workspace-1");

    await scopedDb.transaction(async (tx) => {
      const scopedTx = tx as FakeDb & { _raw: FakeDb; _workspaceId: string };
      scopedTx
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" });
      expect(scopedTx._raw).toBe(rawDb._state.transactionRawDb);
      expect(scopedTx._workspaceId).toBe("workspace-1");
    });
  });

  it("handles unscoped tables by returning the underlying Drizzle builders", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    scopedDb.select().from(usersTbl).where(eq(usersTbl.id, "user-1"));
    scopedDb.insert(usersTbl).values({ id: "user-1", email: "user@example.com" });
    scopedDb.update(usersTbl).set({ email: "new@example.com" }).where(eq(usersTbl.id, "user-1"));
    scopedDb.delete(usersTbl).where(eq(usersTbl.id, "user-1"));

    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(false);
    expect(rawDb._state.insertValues).toEqual({ id: "user-1", email: "user@example.com" });
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id")).toBe(false);
    expect(containsColumnFilter(rawDb._state.deleteCondition, "workspace_id")).toBe(false);
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

  it("leaves joined table conditions unchanged when a joined rule produces no predicate", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId),
        defineScopedTable<string, typeof tasksTbl>(tasksTbl, {
          where: () => undefined,
        }),
      ],
    });

    scopedDb
      .select()
      .from(projectsTbl)
      .leftJoin(tasksTbl, eq(tasksTbl.projectId, projectsTbl.id))
      .where(eq(projectsTbl.id, "project-1"));

    expect(rawDb._state.joinConditions).toHaveLength(1);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "project_id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.joinConditions?.[0], "task_workspace_id")).toBe(false);
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

  it("throws on relational queries without where when strict mode is enabled", () => {
    const scopedDb = createScopedDb(createFakeDb(), {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { queryName: "projects" })],
    });

    expect(() => scopedDb.query.projects.findFirst()).toThrow(MissingScopedWhereError);
  });

  it("allows scoped inserts without insert validation when no validator is declared and validates batch inserts when one is declared", () => {
    const rawDb = createFakeDb();
    const scopedDbWithoutInsertValidation = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    scopedDbWithoutInsertValidation
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-2", name: "No validation" });
    expect(rawDb._state.insertValues).toEqual({
      id: "project-1",
      workspaceId: "workspace-2",
      name: "No validation",
    });

    const scopedDbWithInsertValidation = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });
    scopedDbWithInsertValidation.insert(projectsTbl).values([
      { id: "project-2", workspaceId: "workspace-1", name: "One" },
      { id: "project-3", workspaceId: "workspace-1", name: "Two" },
    ]);

    expect(rawDb._state.insertValues).toEqual([
      { id: "project-2", workspaceId: "workspace-1", name: "One" },
      { id: "project-3", workspaceId: "workspace-1", name: "Two" },
    ]);
  });

  it("supports custom error factories for every scoped validation error", () => {
    const customMissingWhere = new Error("custom missing where");
    const customMissingScope = new Error("custom missing scope");
    const customInvalidInsert = new Error("custom invalid insert");
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

  it("supports scope rules that sometimes do not produce a predicate when strict mode is disabled", () => {
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

    scopedDb.select().from(projectsTbl).where(eq(projectsTbl.id, "project-1"));
    expect(containsColumnFilter(rawDb._state.selectCondition, "id")).toBe(true);
    expect(containsColumnFilter(rawDb._state.selectCondition, "workspace_id")).toBe(false);
  });

  it("handles databases without relational query, selectDistinctOn, or execute properties", () => {
    const rawDb = createFakeDb();
    const {
      query: _query,
      execute: _execute,
      selectDistinctOn: _selectDistinctOn,
      ...dbWithoutQueryOrExecute
    } = rawDb;
    const scopedDb = createScopedDb(dbWithoutQueryOrExecute, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    }) as typeof dbWithoutQueryOrExecute & { query: undefined; execute: undefined };

    expect(scopedDb.query).toBeUndefined();
    expect(scopedDb.execute).toBeUndefined();
    expect(
      (scopedDb as typeof scopedDb & { selectDistinctOn?: unknown }).selectDistinctOn,
    ).toBeUndefined();
  });

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
      "Unable to infer Drizzle column name",
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
