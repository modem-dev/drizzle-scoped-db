import { and, eq, sql } from "drizzle-orm";
import { alias as sqliteAlias } from "drizzle-orm/sqlite-core";

import {
  createScopedDb,
  InvalidScopedInsertError,
  MissingScopedPredicateError,
  scopeByColumn,
} from "../../src/index";
import {
  closeSqliteIntegrationDb,
  createSqliteIntegrationDb,
  seedSqliteProjects,
  seedSqliteTasks,
  sqliteProjects,
  sqliteTasks,
  type SqliteIntegrationDb,
} from "./fixtures/sqlite";

function createScopedSqliteDb(db: SqliteIntegrationDb, workspaceId = "workspace-1") {
  return createScopedDb(db, {
    scopeName: "workspace",
    scopeValue: workspaceId,
    strict: false,
    rules: [
      scopeByColumn(sqliteProjects, sqliteProjects.workspaceId, {
        insertKey: "workspaceId",
      }),
      scopeByColumn(sqliteTasks, sqliteTasks.workspaceId, {
        insertKey: "workspaceId",
      }),
    ],
  });
}

describe("SQLite/sql.js integration", () => {
  it("executes scoped selects against the real SQLite Drizzle driver", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      const rows = await scopedDb.select().from(sqliteProjects);

      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", workspaceId: "workspace-1" }),
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("scopes inner joins against the real SQLite Drizzle driver", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      await seedSqliteTasks(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      const rows = await scopedDb
        .select({
          projectId: sqliteProjects.id,
          taskId: sqliteTasks.id,
          taskWorkspaceId: sqliteTasks.workspaceId,
        })
        .from(sqliteProjects)
        .innerJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id));

      expect(rows).toEqual([
        { projectId: "project-1", taskId: "task-1", taskWorkspaceId: "workspace-1" },
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("preserves left-joined root rows when only out-of-scope joined rows exist", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      await harness.db.insert(sqliteProjects).values({
        id: "project-3",
        workspaceId: "workspace-1",
        slug: "project-3",
        name: "No in-scope tasks",
      });
      await seedSqliteTasks(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      const rows = await scopedDb
        .select({ projectId: sqliteProjects.id, taskId: sqliteTasks.id })
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id));

      expect(rows.sort((left, right) => left.projectId.localeCompare(right.projectId))).toEqual([
        { projectId: "project-1", taskId: "task-1" },
        { projectId: "project-3", taskId: null },
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("scopes joined tables even when the root table has no scoped rule", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      await seedSqliteTasks(harness.db);
      const scopedDb = createScopedDb(harness.db, {
        scopeName: "workspace",
        scopeValue: "workspace-1",
        strict: false,
        rules: [
          scopeByColumn(sqliteTasks, sqliteTasks.workspaceId, {
            insertKey: "workspaceId",
          }),
        ],
      });

      const rows = await scopedDb
        .select({ projectId: sqliteProjects.id, taskId: sqliteTasks.id })
        .from(sqliteProjects)
        .leftJoin(sqliteTasks, eq(sqliteTasks.projectId, sqliteProjects.id));

      expect(rows.sort((left, right) => left.projectId.localeCompare(right.projectId))).toEqual([
        { projectId: "project-1", taskId: "task-1" },
        { projectId: "project-2", taskId: null },
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("fails closed for scoped joined-table aliases without explicit alias rules", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      const scopedDb = createScopedSqliteDb(harness.db);
      const taskAlias = sqliteAlias(sqliteTasks, "task_alias");

      expect(() =>
        scopedDb
          .select()
          .from(sqliteProjects)
          .leftJoin(taskAlias, eq(taskAlias.projectId, sqliteProjects.id)),
      ).toThrow(
        'Aliased scoped table "integration_tasks" is not supported unless the alias has its own explicit scoped rule.',
      );
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("scopes selectDistinct and leaves selectDistinctOn absent at runtime", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      await harness.db.insert(sqliteProjects).values([
        {
          id: "project-3",
          workspaceId: "workspace-1",
          slug: "project-3",
          name: "Duplicate region",
          regionId: "us-east-1",
        },
        {
          id: "project-4",
          workspaceId: "workspace-2",
          slug: "project-4",
          name: "Cross-scope duplicate region",
          regionId: "us-east-1",
        },
      ]);
      const scopedDb = createScopedSqliteDb(harness.db);

      const distinctRegions = await scopedDb
        .selectDistinct({ regionId: sqliteProjects.regionId })
        .from(sqliteProjects);
      expect(distinctRegions).toEqual([{ regionId: "us-east-1" }]);
      expect(
        (scopedDb as unknown as { selectDistinctOn?: unknown }).selectDistinctOn,
      ).toBeUndefined();
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("keeps strict where validation active with real SQLite SQL predicates", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      const scopedDb = createScopedDb(harness.db, {
        scopeName: "workspace",
        scopeValue: "workspace-1",
        strict: true,
        rules: [
          scopeByColumn(sqliteProjects, sqliteProjects.workspaceId, {
            insertKey: "workspaceId",
          }),
        ],
      });

      expect(() =>
        scopedDb.select().from(sqliteProjects).where(eq(sqliteProjects.id, "project-1")),
      ).toThrow(MissingScopedPredicateError);

      await expect(
        scopedDb
          .select()
          .from(sqliteProjects)
          .where(
            and(eq(sqliteProjects.id, "project-1"), eq(sqliteProjects.workspaceId, "workspace-1")),
          ),
      ).resolves.toEqual([]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("validates scoped inserts before executing real SQLite writes", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      const scopedDb = createScopedSqliteDb(harness.db);

      await scopedDb
        .insert(sqliteProjects)
        .values({
          id: "project-1",
          workspaceId: "workspace-1",
          slug: "project-1",
          name: "Roadmap",
        })
        .returning();

      expect(() =>
        scopedDb.insert(sqliteProjects).values({
          id: "project-2",
          workspaceId: "workspace-2",
          slug: "project-2",
          name: "Wrong workspace",
        }),
      ).toThrow(InvalidScopedInsertError);

      expect(() =>
        scopedDb.insert(sqliteProjects).values([
          {
            id: "project-3",
            workspaceId: "workspace-1",
            slug: "project-3",
            name: "Valid batch row",
          },
          {
            id: "project-4",
            workspaceId: "workspace-2",
            slug: "project-4",
            name: "Invalid batch row",
          },
        ]),
      ).toThrow(InvalidScopedInsertError);

      const rows = await harness.db.select().from(sqliteProjects).orderBy(sqliteProjects.id);
      expect(rows.map((row) => row.id)).toEqual(["project-1"]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("executes scoped SQLite inserts and upserts without returning", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      const scopedDb = createScopedSqliteDb(harness.db);

      await scopedDb.insert(sqliteProjects).values({
        id: "project-1",
        workspaceId: "workspace-1",
        slug: "project-1",
        name: "Roadmap",
      });
      await scopedDb
        .insert(sqliteProjects)
        .values({
          id: "project-1",
          workspaceId: "workspace-1",
          slug: "project-1-duplicate",
          name: "Duplicate ignored",
        })
        .onConflictDoNothing();

      const rows = await harness.db.select().from(sqliteProjects).orderBy(sqliteProjects.id);
      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Roadmap", workspaceId: "workspace-1" }),
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("injects scope-only predicates for strict-false SQLite bulk updates and deletes", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      const updatedRows = await scopedDb
        .update(sqliteProjects)
        .set({ name: "Bulk updated" })
        .where(undefined)
        .returning();
      expect(updatedRows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Bulk updated" }),
      ]);

      const [otherWorkspaceAfterUpdate] = await harness.db
        .select()
        .from(sqliteProjects)
        .where(eq(sqliteProjects.id, "project-2"));
      expect(otherWorkspaceAfterUpdate?.name).toBe("Other workspace");

      const deletedRows = await scopedDb.delete(sqliteProjects).where(undefined).returning();
      expect(deletedRows).toEqual([expect.objectContaining({ id: "project-1" })]);

      const remainingRows = await harness.db
        .select()
        .from(sqliteProjects)
        .orderBy(sqliteProjects.id);
      expect(remainingRows).toEqual([
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("scopes real SQLite updates and deletes and keeps returning results guarded", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      const updatedRows = await scopedDb
        .update(sqliteProjects)
        .set({ name: "Updated" })
        .where(eq(sqliteProjects.slug, "project-1"))
        .returning();
      expect(updatedRows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Updated", workspaceId: "workspace-1" }),
      ]);

      const crossScopeUpdate = await scopedDb
        .update(sqliteProjects)
        .set({ name: "Should not update" })
        .where(eq(sqliteProjects.slug, "project-2"))
        .returning();
      expect(crossScopeUpdate).toEqual([]);

      const updateResult = scopedDb
        .update(sqliteProjects)
        .set({ name: "Still guarded" })
        .where(eq(sqliteProjects.slug, "project-1")) as unknown as {
        where(condition: unknown): unknown;
      };
      expect(() => updateResult.where(eq(sqliteProjects.slug, "project-2"))).toThrow();
      expect(() => (updateResult as unknown as { $dynamic(): unknown }).$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

      const returnedUpdateResult = scopedDb
        .update(sqliteProjects)
        .set({ name: "Returned guarded" })
        .where(eq(sqliteProjects.slug, "project-1"))
        .returning() as unknown as { where(condition: unknown): unknown; $dynamic(): unknown };
      expect(() => returnedUpdateResult.where(eq(sqliteProjects.slug, "project-2"))).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );
      expect(() => returnedUpdateResult.$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

      const deletedRows = await scopedDb
        .delete(sqliteProjects)
        .where(eq(sqliteProjects.slug, "project-2"))
        .returning();
      expect(deletedRows).toEqual([]);

      const deleteResult = scopedDb
        .delete(sqliteProjects)
        .where(eq(sqliteProjects.slug, "project-1")) as unknown as {
        where(condition: unknown): unknown;
        $dynamic(): unknown;
      };
      expect(() => deleteResult.where(eq(sqliteProjects.slug, "project-2"))).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );
      expect(() => deleteResult.$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

      const returnedDeleteResult = scopedDb
        .delete(sqliteProjects)
        .where(eq(sqliteProjects.slug, "project-2"))
        .returning() as unknown as { where(condition: unknown): unknown; $dynamic(): unknown };
      expect(() => returnedDeleteResult.where(eq(sqliteProjects.slug, "project-1"))).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );
      expect(() => returnedDeleteResult.$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

      const remainingRows = await harness.db
        .select()
        .from(sqliteProjects)
        .orderBy(sqliteProjects.id);
      expect(remainingRows).toEqual([
        expect.objectContaining({ id: "project-1" }),
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("uses SQLite upsert setWhere guards for cross-scope conflicts", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      const crossScopeRows = await scopedDb
        .insert(sqliteProjects)
        .values({
          id: "project-2",
          workspaceId: "workspace-1",
          slug: "project-2-upsert",
          name: "Cross-scope update attempt",
        })
        .onConflictDoUpdate({
          target: sqliteProjects.id,
          set: { name: "Cross-scope update attempt" },
        })
        .returning();
      expect(crossScopeRows).toEqual([]);

      const [otherWorkspaceRow] = await harness.db
        .select()
        .from(sqliteProjects)
        .where(eq(sqliteProjects.id, "project-2"));
      expect(otherWorkspaceRow?.name).toBe("Other workspace");

      const scopedUpsertResult = scopedDb
        .insert(sqliteProjects)
        .values({
          id: "project-1",
          workspaceId: "workspace-1",
          slug: "project-1-upsert",
          name: "Scoped upsert",
        })
        .onConflictDoUpdate({
          target: sqliteProjects.id,
          set: { name: "Scoped upsert" },
          setWhere: eq(sqliteProjects.name, "Roadmap"),
        });
      expect(() =>
        (scopedUpsertResult as unknown as { where(condition: unknown): unknown }).where(
          eq(sqliteProjects.id, "project-2"),
        ),
      ).toThrow();
      expect(() => (scopedUpsertResult as unknown as { $dynamic(): unknown }).$dynamic()).toThrow();
      const unsafeInsertBuilder = scopedDb
        .insert(sqliteProjects)
        .values({
          id: "project-unsafe",
          workspaceId: "workspace-1",
          slug: "project-unsafe",
          name: "Unsafe escape probe",
        })
        .$unsafeUnscoped() as { onConflictDoUpdate?: unknown };
      expect(typeof unsafeInsertBuilder.onConflictDoUpdate).toBe("function");

      const scopedRows = await scopedUpsertResult.returning();
      expect(scopedRows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Scoped upsert" }),
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });

  it("wraps real SQLite transactions with the same scope", async () => {
    const harness = await createSqliteIntegrationDb();
    try {
      await seedSqliteProjects(harness.db);
      const scopedDb = createScopedSqliteDb(harness.db);

      await scopedDb.transaction((tx) => {
        tx.update(sqliteProjects)
          .set({ name: "Updated in tx" })
          .where(eq(sqliteProjects.id, "project-1"))
          .run();
        tx.update(sqliteProjects)
          .set({ name: "Cross-scope tx attempt" })
          .where(eq(sqliteProjects.id, "project-2"))
          .run();
        tx.insert(sqliteProjects)
          .values({
            id: "project-3",
            workspaceId: "workspace-1",
            slug: "project-3",
            name: "Inserted in tx",
          })
          .run();
        tx.insert(sqliteProjects)
          .values({
            id: "project-2",
            workspaceId: "workspace-1",
            slug: "project-2-tx-upsert",
            name: "Cross-scope tx upsert",
          })
          .onConflictDoUpdate({
            target: sqliteProjects.id,
            set: { name: "Cross-scope tx upsert" },
          })
          .run();
      });

      const rows = await harness.db.select().from(sqliteProjects).orderBy(sqliteProjects.id);
      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Updated in tx" }),
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
        expect.objectContaining({ id: "project-3", name: "Inserted in tx" }),
      ]);

      await expect(
        scopedDb.transaction((tx) => {
          (tx._unsafeUnscopedDb as { run(query: unknown): unknown }).run(
            sql.raw(
              "insert into integration_projects (id, workspace_id, slug, name) values ('project-4', 'workspace-1', 'project-4', 'Rolled back')",
            ),
          );
          throw new Error("rollback sqlite transaction");
        }),
      ).rejects.toThrow("rollback sqlite transaction");

      const rolledBackRows = await harness.db
        .select()
        .from(sqliteProjects)
        .where(eq(sqliteProjects.id, "project-4"));
      expect(rolledBackRows).toEqual([]);

      await expect(
        scopedDb.transaction((tx) => {
          (tx._unsafeUnscopedDb as { run(query: unknown): unknown }).run(
            sql.raw(
              "insert into integration_projects (id, workspace_id, slug, name) values ('project-5', 'workspace-1', 'project-5', 'Rolled back before invalid insert')",
            ),
          );
          tx.insert(sqliteProjects).values({
            id: "project-6",
            workspaceId: "workspace-2",
            slug: "project-6",
            name: "Invalid tx insert",
          });
          return "unreachable";
        }),
      ).rejects.toThrow(InvalidScopedInsertError);

      const invalidInsertRollbackRows = await harness.db
        .select()
        .from(sqliteProjects)
        .where(eq(sqliteProjects.id, "project-5"));
      expect(invalidInsertRollbackRows).toEqual([]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });
});
