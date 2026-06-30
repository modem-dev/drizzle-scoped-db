import { and, eq } from "drizzle-orm";

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
  sqliteProjects,
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

      const deletedRows = await scopedDb
        .delete(sqliteProjects)
        .where(eq(sqliteProjects.slug, "project-2"))
        .returning();
      expect(deletedRows).toEqual([]);

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

      const scopedRows = await scopedDb
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
        })
        .returning();
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

      await scopedDb.transaction(async (tx) => {
        await tx
          .update(sqliteProjects)
          .set({ name: "Updated in tx" })
          .where(eq(sqliteProjects.id, "project-1"));
        await tx
          .update(sqliteProjects)
          .set({ name: "Cross-scope tx attempt" })
          .where(eq(sqliteProjects.id, "project-2"));
      });

      const rows = await harness.db.select().from(sqliteProjects).orderBy(sqliteProjects.id);
      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Updated in tx" }),
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
      ]);
    } finally {
      closeSqliteIntegrationDb(harness);
    }
  });
});
