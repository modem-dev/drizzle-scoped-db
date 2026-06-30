import {
  eq,
  containsColumnFilter,
  createScopedDb,
  scopeByColumn,
  projectsTbl,
  usersTbl,
  createFakeDb,
  type SQL,
  type ScopedDb,
} from "./fixtures";

describe("createScopedDb API surface and passthroughs", () => {
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
    });

    expect(scopedDb._raw).toBe(rawDb);
    expect(scopedDb._workspaceId).toBe("workspace-1");
    expect(scopedDb.toJSON?.()).toEqual({ scopeValue: "workspace-1" });
    scopedDb.assertWorkspaceId("workspace-1");
    expect((scopedDb as unknown as { execute?: unknown }).execute).toBeUndefined();
    expect(scopedDb._raw.execute()).toBeUndefined();

    await scopedDb.transaction(async (tx) => {
      tx.insert(projectsTbl).values({
        id: "project-1",
        workspaceId: "workspace-1",
        name: "Roadmap",
      });
      tx.assertWorkspaceId("workspace-1");
      expect(tx._raw).toBe(rawDb._state.transactionRawDb);
      expect(tx._workspaceId).toBe("workspace-1");
    });
  });

  it("keeps the scoped builder surface narrow at the type level", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId, {
          insertKey: "workspaceId",
          queryName: "projects",
        }),
      ],
    });

    rawDb.select().from(projectsTbl).prepare();
    rawDb.insert(projectsTbl).values({ id: "raw" }).returning();
    rawDb.update(projectsTbl).set({ name: "Updated" }).where(undefined).returning();
    rawDb.delete(projectsTbl).where(undefined).returning();

    expect(scopedDb.query.projects).toBeDefined();

    const selectBuilder = scopedDb.select().from(projectsTbl);
    selectBuilder.where(eq(projectsTbl.id, "project-1"));
    selectBuilder.leftJoin(usersTbl, eq(usersTbl.id, projectsTbl.id));
    selectBuilder.innerJoin(usersTbl, eq(usersTbl.id, projectsTbl.id));
    // @ts-expect-error Scoped select builders do not promise Drizzle's prepare() API.
    void selectBuilder.prepare;

    const distinctSelectBuilder = scopedDb.selectDistinct().from(projectsTbl);
    distinctSelectBuilder.where(eq(projectsTbl.id, "project-2"));
    // @ts-expect-error Scoped select builders do not promise Drizzle's as() API.
    void distinctSelectBuilder.as;

    const distinctOnBuilder = scopedDb
      .selectDistinctOn([projectsTbl.id], { id: projectsTbl.id })
      .from(projectsTbl);
    distinctOnBuilder.where(eq(projectsTbl.id, "project-3"));
    // @ts-expect-error Scoped selectDistinctOn builders stay narrow too.
    void distinctOnBuilder.prepare;

    const _assertProjectionChaining = async (db: typeof scopedDb) => {
      const rows = await db
        .select({ id: projectsTbl.id, name: projectsTbl.name })
        .from(projectsTbl)
        .where(eq(projectsTbl.id, "project-typed"))
        .groupBy(projectsTbl.id)
        .having(eq(projectsTbl.id, "project-typed"))
        .orderBy(projectsTbl.name)
        .limit(10)
        .offset(0);
      const id: string = rows[0]!.id;
      const name: string = rows[0]!.name;
      // @ts-expect-error Scoped where-builder chaining preserves projection types.
      const badId: number = rows[0]!.id;
      void [id, name, badId];
    };
    void _assertProjectionChaining;

    const insertBuilder = scopedDb.insert(projectsTbl);
    insertBuilder.values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" });
    // @ts-expect-error Scoped insert builders only expose values().
    void insertBuilder.returning;

    const updateBuilder = scopedDb.update(projectsTbl).set({ name: "Updated" });
    updateBuilder.where(eq(projectsTbl.id, "project-1"));
    // @ts-expect-error Scoped update builders only expose where() after set().
    void updateBuilder.returning;

    const deleteBuilder = scopedDb.delete(projectsTbl);
    deleteBuilder.where(eq(projectsTbl.id, "project-1"));
    // @ts-expect-error Scoped delete builders only expose where().
    void deleteBuilder.returning;

    // Once scope is injected, the terminal result exposes the dialect's RETURNING clause directly.
    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .returning();

    // PostgreSQL/SQLite conflict methods can be chained directly; onConflictDoUpdate is
    // runtime-validated for a scope-safe set payload and guarded with scoped setWhere.
    const scopedConflictInsert = scopedDb
      .insert(projectsTbl)
      .values({ id: "project-2", workspaceId: "workspace-1", name: "Backlog" });
    scopedConflictInsert.onConflictDoNothing().returning();
    const scopedConflictUpdateInsert = scopedDb
      .insert(projectsTbl)
      .values({ id: "project-3", workspaceId: "workspace-1", name: "Icebox" });
    scopedConflictUpdateInsert.onConflictDoUpdate({
      target: projectsTbl.id,
      set: { name: "Icebox" },
    });
    // The local escape is still available for intentionally unaudited raw continuation.
    scopedConflictUpdateInsert
      .$unsafeUnscoped()
      .onConflictDoUpdate({ target: projectsTbl.id, set: { workspaceId: "workspace-2" } });
    scopedDb
      .update(projectsTbl)
      .set({ name: "Updated" })
      .where(eq(projectsTbl.id, "p"))
      .returning();
    scopedDb.delete(projectsTbl).where(eq(projectsTbl.id, "p")).returning();

    await scopedDb.transaction(async (tx) => {
      tx.select().from(projectsTbl).where(eq(projectsTbl.id, "project-4"));
      await tx.query.projects.findFirst({
        where: (project, { eq }) => eq(project.id, "project-4"),
      });
      // @ts-expect-error Transaction-scoped wrappers do not expose raw execute().
      void tx.execute;
      // @ts-expect-error Transaction-scoped builders stay narrowed too.
      void tx.select().from(projectsTbl).prepare;
    });
  });

  it("forwards only safe dialect terminal methods (MySQL vs Postgres)", () => {
    // A MySQL-shaped DB: inserts resolve to row-count metadata with MySQL's inserted-id helper,
    // and have no RETURNING clause. MySQL upsert helpers are intentionally hidden by the scoped facade.
    type MySqlLikeDb = {
      insert(table: unknown): {
        values(values: unknown): {
          rowsAffected: number;
          $returningId(): unknown;
          onDuplicateKeyUpdate(config: unknown): unknown;
        };
      };
      update(table: unknown): {
        set(values: Record<string, unknown>): {
          where(condition: SQL | undefined): { rowsAffected: number };
        };
      };
      delete(table: unknown): { where(condition: SQL | undefined): { rowsAffected: number } };
    };

    // Type-level assertion only; never invoked at runtime.
    const _assertDialectMethods = (db: ScopedDb<MySqlLikeDb, string>) => {
      // MySQL's inserted-id helper is forwarded when present.
      void db
        .insert(projectsTbl)
        .values({ id: "p", workspaceId: "w", name: "Roadmap" })
        .$returningId();

      // MySQL's upsert helper is withheld until the local escape, where the raw builder exposes it.
      const mysqlInsert = db
        .insert(projectsTbl)
        .values({ id: "p", workspaceId: "w", name: "Roadmap" });
      mysqlInsert.$unsafeUnscoped().onDuplicateKeyUpdate({ set: {} });

      // The scoped result exposes only dialect conflict methods that can be validated safely.
      // @ts-expect-error MySQL-style insert builders have no onConflictDoNothing().
      void mysqlInsert.onConflictDoNothing;
      // @ts-expect-error MySQL's targetless upsert helper still requires the unsafe transition.
      void mysqlInsert.onDuplicateKeyUpdate;
      // @ts-expect-error MySQL-style insert builders expose no RETURNING clause.
      void mysqlInsert.returning;
      // @ts-expect-error MySQL-style raw insert builders have no onConflictDoNothing().
      void mysqlInsert.$unsafeUnscoped().onConflictDoNothing;
      // @ts-expect-error MySQL-style update builders expose no RETURNING clause.
      void db.update(projectsTbl).set({ name: "n" }).where(undefined).returning;
      // @ts-expect-error MySQL-style delete builders expose no RETURNING clause.
      void db.delete(projectsTbl).where(undefined).returning;
    };
    void _assertDialectMethods;
  });

  it("preserves raw Drizzle insert and update payload types", () => {
    type ProjectInsert = { id: string; workspaceId: string; name: string };
    type ProjectUpdate = { name?: string; workspaceId?: string };
    type StrictMutationDb = {
      insert(table: typeof projectsTbl): {
        values(value: ProjectInsert): { returning(): unknown };
        values(values: ProjectInsert[]): { returning(): unknown };
      };
      update(table: typeof projectsTbl): {
        set(values: ProjectUpdate): {
          where(condition: SQL | undefined): { returning(): unknown };
        };
      };
      delete(table: typeof projectsTbl): {
        where(condition: SQL | undefined): { returning(): unknown };
      };
    };

    // Type-level assertion only; never invoked at runtime.
    const _assertPayloadTypes = (db: ScopedDb<StrictMutationDb, string>) => {
      db.insert(projectsTbl).values({ id: "p", workspaceId: "w", name: "Roadmap" });
      db.insert(projectsTbl).values([{ id: "p", workspaceId: "w", name: "Roadmap" }]);
      db.update(projectsTbl).set({ name: "Updated" });

      // @ts-expect-error Scoped insert values keep the raw builder's table-specific payload type.
      db.insert(projectsTbl).values({ id: 123, workspaceId: "w", name: "Roadmap" });
      // @ts-expect-error Scoped insert values reject unknown columns when the raw builder does.
      db.insert(projectsTbl).values({ id: "p", workspaceId: "w", nope: true });
      // @ts-expect-error Scoped update values keep the raw builder's table-specific payload type.
      db.update(projectsTbl).set({ nope: true });
    };
    void _assertPayloadTypes;
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
    }) as typeof dbWithoutQueryOrExecute & { query: undefined };

    expect(scopedDb.query).toBeUndefined();
    expect((scopedDb as unknown as { execute?: unknown }).execute).toBeUndefined();
    expect(
      (scopedDb as typeof scopedDb & { selectDistinctOn?: unknown }).selectDistinctOn,
    ).toBeUndefined();
  });
});
