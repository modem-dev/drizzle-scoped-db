import * as drizzleOrm from "drizzle-orm";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";

import {
  createScopedDb,
  InvalidScopedInsertError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  scopeByColumn,
} from "../../src/index";
import {
  closePgIntegrationDb,
  createPgIntegrationDb,
  createPgRelationalDb,
  createPgRqbV2RelationalDb,
  pgProjects,
  seedPgProjects,
  type PgIntegrationDb,
} from "./fixtures/postgres";

const pgUpdateMarkers = pgTable("integration_update_markers", {
  id: text("id").primaryKey(),
});

function createScopedPgDb(db: PgIntegrationDb, workspaceId = "workspace-1") {
  return createScopedDb(db, {
    scopeName: "workspace",
    scopeValue: workspaceId,
    strict: false,
    rules: [
      scopeByColumn(pgProjects, pgProjects.workspaceId, {
        insertKey: "workspaceId",
      }),
    ],
  });
}

describe("Postgres/PGlite integration", () => {
  it("executes scoped selects against the real PGlite driver", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      const scopedDb = createScopedPgDb(db);

      const rows = await scopedDb.select().from(pgProjects);

      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", workspaceId: "workspace-1" }),
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("keeps strict where validation active with real Drizzle SQL predicates", async () => {
    const db = await createPgIntegrationDb();
    try {
      const scopedDb = createScopedDb(db, {
        scopeName: "workspace",
        scopeValue: "workspace-1",
        strict: true,
        rules: [
          scopeByColumn(pgProjects, pgProjects.workspaceId, {
            insertKey: "workspaceId",
          }),
        ],
      });

      expect(() =>
        scopedDb.select().from(pgProjects).where(eq(pgProjects.id, "project-1")),
      ).toThrow(MissingScopedPredicateError);

      await expect(
        scopedDb
          .select()
          .from(pgProjects)
          .where(and(eq(pgProjects.id, "project-1"), eq(pgProjects.workspaceId, "workspace-1"))),
      ).resolves.toEqual([]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  // Drizzle 1.0 replaced the schema-only relational query (callback `where`) with the RQBv2
  // object-filter API (`defineRelations`). This regression targets the callback relational path
  // that current consumers use against a real database; it is transparently skipped on Drizzle
  // builds that only expose RQBv2 (a 1.0 variant can be added when the wrapper supports it). The
  // version-agnostic getTableKey fix it guards is still covered on every Drizzle version by the
  // drizzle-compat unit tests that exercise real table aliases.
  const supportsCallbackRelationalQuery = !(
    "defineRelations" in (drizzleOrm as Record<string, unknown>)
  );

  it.skipIf(!supportsCallbackRelationalQuery)(
    "accepts the scope predicate in strict relational where callbacks (aliased columns)",
    async () => {
      // Regression: Drizzle's relational query API (`db.query.projectsTbl.findMany`) hands the where
      // callback columns aliased to the schema key `projectsTbl`, while the rule's table reports its
      // SQL name `integration_projects`. Strict scope-in-where detection must still recognize the
      // scope filter through that alias instead of throwing MissingScopedPredicateError.
      const db = await createPgRelationalDb();
      try {
        await seedPgProjects(db);
        const scopedDb = createScopedDb(db, {
          scopeName: "workspace",
          scopeValue: "workspace-1",
          strict: true,
          rules: [
            scopeByColumn(pgProjects, pgProjects.workspaceId, {
              insertKey: "workspaceId",
              queryName: "projectsTbl",
            }),
          ],
        });

        const rows = await scopedDb.query.projectsTbl.findMany({
          where: (project, { eq: eqOp }) => eqOp(project.workspaceId, "workspace-1"),
        });
        expect(rows).toEqual([
          expect.objectContaining({ id: "project-1", workspaceId: "workspace-1" }),
        ]);

        const scopedWhere = (
          project: { workspaceId: unknown },
          { eq: eqOp }: { eq: (left: unknown, right: unknown) => SQL },
        ) => eqOp(project.workspaceId, "workspace-1");
        expect(() =>
          scopedDb.query.projectsTbl.findMany({
            where: scopedWhere,
            with: {},
          } as never),
        ).toThrow("does not support nested `with` relations");

        // A relational where that omits the scope column is still rejected through the same path.
        await expect(
          scopedDb.query.projectsTbl.findMany({
            where: (project, { eq: eqOp }) => eqOp(project.id, "project-1"),
          }),
        ).rejects.toThrow(MissingScopedPredicateError);
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  const supportsRqbV2RelationalQuery = "defineRelations" in (drizzleOrm as Record<string, unknown>);

  it.skipIf(!supportsRqbV2RelationalQuery)(
    "scopes strict RQBv2 relational object filters against the real PGlite driver",
    async () => {
      const db = await createPgRqbV2RelationalDb();
      try {
        await seedPgProjects(db);
        const scopedDb = createScopedDb(db, {
          scopeName: "workspace",
          scopeValue: "workspace-1",
          strict: true,
          rules: [
            scopeByColumn(pgProjects, pgProjects.workspaceId, {
              insertKey: "workspaceId",
              queryName: "projectsTbl",
            }),
          ],
        });

        expect(() => scopedDb.query.projectsTbl.findMany()).toThrow(MissingScopedWhereError);
        expect(() => scopedDb.query.projectsTbl.findMany({ where: { id: "project-1" } })).toThrow(
          MissingScopedPredicateError,
        );

        const rows = await scopedDb.query.projectsTbl.findMany({
          where: { workspaceId: "workspace-1" },
        });
        expect(rows).toEqual([
          expect.objectContaining({ id: "project-1", workspaceId: "workspace-1" }),
        ]);

        expect(() =>
          scopedDb.query.projectsTbl.findMany({
            where: { workspaceId: "workspace-1" },
            with: {},
          } as never),
        ).toThrow("does not support nested `with` relations");

        const crossScopeRows = await scopedDb.query.projectsTbl.findMany({
          where: { workspaceId: "workspace-2" },
        });
        expect(crossScopeRows).toEqual([]);
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  it("validates scoped inserts before executing real Postgres writes", async () => {
    const db = await createPgIntegrationDb();
    try {
      const scopedDb = createScopedPgDb(db);

      await scopedDb
        .insert(pgProjects)
        .values({
          id: "project-1",
          workspaceId: "workspace-1",
          slug: "project-1",
          name: "Roadmap",
        })
        .returning();

      expect(() =>
        scopedDb.insert(pgProjects).values({
          id: "project-2",
          workspaceId: "workspace-2",
          slug: "project-2",
          name: "Wrong workspace",
        }),
      ).toThrow(InvalidScopedInsertError);

      expect(() =>
        scopedDb.insert(pgProjects).values([
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

      const rows = await db.select().from(pgProjects).orderBy(pgProjects.id);
      expect(rows.map((row) => row.id)).toEqual(["project-1"]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("scopes real Postgres updates and deletes and keeps returning results guarded", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      const scopedDb = createScopedPgDb(db);

      const updatedRows = await scopedDb
        .update(pgProjects)
        .set({ name: "Updated" })
        .where(eq(pgProjects.slug, "project-1"))
        .returning();
      expect(updatedRows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Updated", workspaceId: "workspace-1" }),
      ]);

      const crossScopeUpdate = await scopedDb
        .update(pgProjects)
        .set({ name: "Should not update" })
        .where(eq(pgProjects.slug, "project-2"))
        .returning();
      expect(crossScopeUpdate).toEqual([]);

      const updateResult = scopedDb
        .update(pgProjects)
        .set({ name: "Still guarded" })
        .where(eq(pgProjects.slug, "project-1")) as unknown as {
        where(condition: unknown): unknown;
        from(table: unknown): { where(condition: unknown): { returning(): unknown } };
      };
      expect(() => updateResult.where(eq(pgProjects.slug, "project-2"))).toThrow();

      await db.execute(sql.raw("create table integration_update_markers (id text primary key);"));
      await db.insert(pgUpdateMarkers).values({ id: "marker-1" });
      await expect(async () => {
        await updateResult
          .from(pgUpdateMarkers)
          .where(eq(pgProjects.slug, "project-2"))
          .returning();
      }).rejects.toThrow("Scoped mutation results do not expose raw query-builder chaining.");
      const [otherWorkspaceAfterEscapeAttempt] = await db
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-2"));
      expect(otherWorkspaceAfterEscapeAttempt?.name).toBe("Other workspace");

      const deletedRows = await scopedDb
        .delete(pgProjects)
        .where(eq(pgProjects.slug, "project-2"))
        .returning();
      expect(deletedRows).toEqual([]);

      const remainingRows = await db.select().from(pgProjects).orderBy(pgProjects.id);
      expect(remainingRows).toEqual([
        expect.objectContaining({ id: "project-1" }),
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("adds Postgres upsert setWhere guards for cross-scope conflicts", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      const scopedDb = createScopedPgDb(db);

      const crossScopeRows = await scopedDb
        .insert(pgProjects)
        .values({
          id: "project-2",
          workspaceId: "workspace-1",
          slug: "project-2-upsert",
          name: "Cross-scope update attempt",
        })
        .onConflictDoUpdate({
          target: pgProjects.id,
          set: { name: "Cross-scope update attempt" },
        })
        .returning();
      expect(crossScopeRows).toEqual([]);

      const [otherWorkspaceRow] = await db
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-2"));
      expect(otherWorkspaceRow?.name).toBe("Other workspace");

      const scopedRows = await scopedDb
        .insert(pgProjects)
        .values({
          id: "project-1",
          workspaceId: "workspace-1",
          slug: "project-1-upsert",
          name: "Scoped upsert",
        })
        .onConflictDoUpdate({
          target: pgProjects.id,
          set: { name: "Scoped upsert" },
          setWhere: eq(pgProjects.name, "Roadmap"),
        })
        .returning();
      expect(scopedRows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Scoped upsert" }),
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("wraps real Postgres transactions with the same scope", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      const scopedDb = createScopedPgDb(db);

      await scopedDb.transaction(async (tx) => {
        await tx
          .update(pgProjects)
          .set({ name: "Updated in tx" })
          .where(eq(pgProjects.id, "project-1"));
        await tx
          .update(pgProjects)
          .set({ name: "Cross-scope tx attempt" })
          .where(eq(pgProjects.id, "project-2"));
      });

      const rows = await db.select().from(pgProjects).orderBy(pgProjects.id);
      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Updated in tx" }),
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
      ]);

      await expect(
        scopedDb.transaction(async (tx) => {
          await tx.insert(pgProjects).values({
            id: "project-3",
            workspaceId: "workspace-1",
            slug: "project-3",
            name: "Rolled back",
          });
          await tx._unsafeUnscopedDb.execute(sql`select boom from missing_table`);
        }),
      ).rejects.toThrow();

      const rolledBackRows = await db
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-3"));
      expect(rolledBackRows).toEqual([]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });
});
