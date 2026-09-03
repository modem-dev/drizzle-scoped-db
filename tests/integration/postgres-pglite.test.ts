import * as drizzleOrm from "drizzle-orm";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import { alias as pgAlias, pgTable, text } from "drizzle-orm/pg-core";

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
  createPgWithRelationalDb,
  pgProjects,
  pgTasks,
  pgWithProjects,
  pgWithTasks,
  seedPgProjects,
  seedPgTasks,
  seedPgUntaskedProject,
  seedPgWithRelations,
  supportsRqbV1Relations,
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
      scopeByColumn(pgProjects, pgProjects.workspaceId),
      scopeByColumn(pgTasks, pgTasks.workspaceId),
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

  it("executes a chained scoped select once against the real PGlite driver", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      await db.execute(sql.raw("create sequence integration_select_execution_count"));
      const scopedDb = createScopedPgDb(db);

      const rows = await scopedDb
        .select({
          id: pgProjects.id,
          executionMarker: sql<number>`nextval('integration_select_execution_count')::integer`,
        })
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-1"))
        .orderBy(pgProjects.id)
        .limit(10)
        .offset(0);

      expect(rows).toEqual([{ id: "project-1", executionMarker: 1 }]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("scopes inner joins against the real PGlite driver", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      await seedPgTasks(db);
      const scopedDb = createScopedPgDb(db);

      const rows = await scopedDb
        .select({
          projectId: pgProjects.id,
          taskId: pgTasks.id,
          taskWorkspaceId: pgTasks.workspaceId,
        })
        .from(pgProjects)
        .innerJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));

      expect(rows).toEqual([
        { projectId: "project-1", taskId: "task-1", taskWorkspaceId: "workspace-1" },
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("preserves left-joined root rows when only out-of-scope joined rows exist", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      await seedPgUntaskedProject(db);
      await seedPgTasks(db);
      const scopedDb = createScopedPgDb(db);

      const rows = await scopedDb
        .select({ projectId: pgProjects.id, taskId: pgTasks.id })
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));

      expect(rows.sort((left, right) => left.projectId.localeCompare(right.projectId))).toEqual([
        { projectId: "project-1", taskId: "task-1" },
        { projectId: "project-3", taskId: null },
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("returns Drizzle's nested per-table rows for whole-row left joins", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      await seedPgUntaskedProject(db);
      await seedPgTasks(db);
      const scopedDb = createScopedPgDb(db);

      const rows = await scopedDb
        .select()
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));

      expectTypeOf(rows).toEqualTypeOf<
        {
          integration_projects: typeof pgProjects.$inferSelect;
          integration_tasks: typeof pgTasks.$inferSelect | null;
        }[]
      >();
      rows.sort((left, right) =>
        left.integration_projects.id.localeCompare(right.integration_projects.id),
      );
      expect(rows.map((row) => row.integration_projects.id)).toEqual(["project-1", "project-3"]);
      expect(rows[0]?.integration_tasks?.id).toBe("task-1");
      expect(rows[1]?.integration_tasks).toBeNull();
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("scopes joined tables even when the root table has no scoped rule", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      await seedPgTasks(db);
      const scopedDb = createScopedDb(db, {
        scopeName: "workspace",
        scopeValue: "workspace-1",
        strict: false,
        rules: [
          scopeByColumn(pgTasks, pgTasks.workspaceId, {
            insertKey: "workspaceId",
          }),
        ],
      });

      const rows = await scopedDb
        .select({ projectId: pgProjects.id, taskId: pgTasks.id })
        .from(pgProjects)
        .leftJoin(pgTasks, eq(pgTasks.projectId, pgProjects.id));

      expect(rows.sort((left, right) => left.projectId.localeCompare(right.projectId))).toEqual([
        { projectId: "project-1", taskId: "task-1" },
        { projectId: "project-2", taskId: null },
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("fails closed for scoped joined-table aliases without explicit alias rules", async () => {
    const db = await createPgIntegrationDb();
    try {
      const scopedDb = createScopedPgDb(db);
      const taskAlias = pgAlias(pgTasks, "task_alias");

      expect(() =>
        scopedDb
          .select()
          .from(pgProjects)
          .leftJoin(taskAlias, eq(taskAlias.projectId, pgProjects.id)),
      ).toThrow(
        'Aliased scoped table "integration_tasks" is not supported unless the alias has its own explicit scoped rule.',
      );
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("scopes selectDistinct and selectDistinctOn against the real PGlite driver", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      await db.insert(pgProjects).values([
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
      const scopedDb = createScopedPgDb(db);

      const distinctRegions = await scopedDb
        .selectDistinct({ regionId: pgProjects.regionId })
        .from(pgProjects);
      expect(distinctRegions).toEqual([{ regionId: "us-east-1" }]);

      const distinctOnRows = await scopedDb
        .selectDistinctOn([pgProjects.regionId], {
          id: pgProjects.id,
          regionId: pgProjects.regionId,
        })
        .from(pgProjects);
      expect(distinctOnRows).toHaveLength(1);
      expect(distinctOnRows[0]?.regionId).toBe("us-east-1");
      expect(["project-1", "project-3"]).toContain(distinctOnRows[0]?.id);
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

  it("ands the injected scope guard onto syntactically valid but misleading strict SQL predicates", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
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

      const rows = await scopedDb
        .select({ id: pgProjects.id, workspaceId: pgProjects.workspaceId })
        .from(pgProjects)
        .where(ne(pgProjects.workspaceId, "workspace-1"));

      expect(rows).toEqual([]);
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

        // This schema registers no relations, so a nested include cannot resolve to a table and
        // fails closed rather than loading unscoped rows.
        const scopedWhere = (
          project: { workspaceId: unknown },
          { eq: eqOp }: { eq: (left: unknown, right: unknown) => SQL },
        ) => eqOp(project.workspaceId, "workspace-1");
        expect(() =>
          scopedDb.query.projectsTbl.findMany({
            where: scopedWhere,
            with: { tasks: true },
          } as never),
        ).toThrow('cannot resolve nested relation "tasks"');

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

  function createScopedWithDb(
    db: Awaited<ReturnType<typeof createPgWithRelationalDb>>,
    workspaceId = "workspace-1",
  ) {
    return createScopedDb(db, {
      scopeName: "workspace",
      scopeValue: workspaceId,
      strict: false,
      rules: [
        scopeByColumn(pgWithProjects, pgWithProjects.workspaceId, { queryName: "projectsTbl" }),
        scopeByColumn(pgWithTasks, pgWithTasks.workspaceId, { queryName: "tasksTbl" }),
        // notesTbl intentionally has no rule: it is an unscoped child relation.
      ],
    });
  }

  it.skipIf(!supportsRqbV1Relations)(
    "scopes nested `with` relations to exclude cross-scope rows against the real PGlite driver",
    async () => {
      const db = await createPgWithRelationalDb();
      try {
        await seedPgWithRelations(db);
        const scopedDb = createScopedWithDb(db);

        const projects = await scopedDb.query.projectsTbl.findMany({
          where: (project, { eq: eqOp }) => eqOp(project.workspaceId, "workspace-1"),
          with: { tasks: true },
        });

        // project-1 is in scope; its cross-workspace task-2 is filtered out of the nested include.
        expect(projects).toHaveLength(1);
        expect(projects[0]).toMatchObject({ id: "project-1" });
        expect((projects[0]!.tasks as Array<{ id: string }>).map((task) => task.id)).toEqual([
          "task-1",
        ]);
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  it.skipIf(!supportsRqbV1Relations)(
    "scopes deeply nested `with` includes, honors a caller nested where, and leaves unscoped children intact",
    async () => {
      const db = await createPgWithRelationalDb();
      try {
        await seedPgWithRelations(db);
        const scopedDb = createScopedWithDb(db);

        const project = await scopedDb.query.projectsTbl.findFirst({
          where: (p, { eq: eqOp }) => eqOp(p.id, "project-1"),
          with: {
            tasks: {
              // Caller-supplied nested where (callback) is ANDed with the injected workspace scope.
              where: (
                t: { title: unknown },
                { eq: eqOp }: { eq: (left: unknown, right: unknown) => SQL },
              ) => eqOp(t.title, "In-scope task"),
              with: {
                // Second level of scoped nesting: task → project.
                project: true,
                // notes has no rule, so task-1's notes load fully (unscoped by design).
                notes: true,
              },
            },
          },
        });

        const tasks = project!.tasks as Array<{
          id: string;
          project: { id: string };
          notes: unknown[];
        }>;
        expect(tasks.map((task) => task.id)).toEqual(["task-1"]);
        expect(tasks[0]!.project.id).toBe("project-1");
        expect((tasks[0]!.notes as Array<{ id: string }>).map((note) => note.id)).toEqual([
          "note-1",
          "note-2",
        ]);
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  it.skipIf(!supportsRqbV1Relations)(
    "injects scope alongside a raw SQL nested where and excludes `with: false` relations",
    async () => {
      const db = await createPgWithRelationalDb();
      try {
        await seedPgWithRelations(db);
        const scopedDb = createScopedWithDb(db);

        // A raw SQL nested where (not a callback) is still ANDed with the injected workspace scope.
        const withRawWhere = await scopedDb.query.projectsTbl.findFirst({
          where: (p, { eq: eqOp }) => eqOp(p.id, "project-1"),
          with: { tasks: { where: eq(pgWithTasks.title, "In-scope task") } as never },
        });
        expect((withRawWhere!.tasks as Array<{ id: string }>).map((task) => task.id)).toEqual([
          "task-1",
        ]);

        // `with: { tasks: false }` excludes the relation entirely, so no scoping applies.
        const withoutTasks = await scopedDb.query.projectsTbl.findFirst({
          where: (p, { eq: eqOp }) => eqOp(p.id, "project-1"),
          with: { tasks: false as never },
        });
        expect(withoutTasks).toMatchObject({ id: "project-1" });
        expect(withoutTasks!.tasks).toBeUndefined();
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  it.skipIf(!supportsRqbV1Relations)(
    "scopes a nested include reached from an unscoped relational root",
    async () => {
      const db = await createPgWithRelationalDb();
      try {
        await seedPgWithRelations(db);
        const scopedDb = createScopedWithDb(db);

        // notesTbl has no rule, so the root is unscoped and returns every note, but the nested `task`
        // include reaches a scoped table, so out-of-scope tasks are filtered to null.
        const notes = await scopedDb.query.notesTbl.findMany({ with: { task: true } });

        const byId = new Map(notes.map((note) => [note.id as string, note.task]));
        expect((byId.get("note-1") as { id: string }).id).toBe("task-1");
        // note-3's task-3 belongs to workspace-2, so it is filtered out of the scoped include.
        expect(byId.get("note-3")).toBeNull();
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  it.skipIf(!supportsRqbV1Relations)(
    "fails closed on a nested `with` include when a scoped rule cannot produce its predicate",
    async () => {
      const db = await createPgWithRelationalDb();
      try {
        await seedPgWithRelations(db);
        const scopedDb = createScopedDb(db, {
          scopeName: "workspace",
          scopeValue: "workspace-1",
          strict: false,
          rules: [
            scopeByColumn(pgWithProjects, pgWithProjects.workspaceId, { queryName: "projectsTbl" }),
            // A tasks rule whose predicate resolves to undefined must not silently load nested rows.
            {
              table: pgWithTasks,
              queryName: "tasksTbl",
              where: () => undefined,
            },
          ],
        });

        expect(() => scopedDb.query.projectsTbl.findMany({ with: { tasks: true } })).toThrow(
          "did not produce a scope predicate",
        );
      } finally {
        await closePgIntegrationDb(db);
      }
    },
  );

  it.skipIf(!supportsRqbV1Relations)(
    "fails closed when a nested relation cannot be resolved to a scoped table",
    async () => {
      const db = await createPgWithRelationalDb();
      try {
        await seedPgWithRelations(db);
        const scopedDb = createScopedWithDb(db);

        expect(() =>
          scopedDb.query.projectsTbl.findMany({ with: { nonexistent: true } as never }),
        ).toThrow('cannot resolve nested relation "nonexistent"');
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

  it("executes scoped Postgres inserts and upserts without returning", async () => {
    const db = await createPgIntegrationDb();
    try {
      const scopedDb = createScopedPgDb(db);

      await scopedDb.insert(pgProjects).values({
        id: "project-1",
        workspaceId: "workspace-1",
        slug: "project-1",
        name: "Roadmap",
      });
      await scopedDb
        .insert(pgProjects)
        .values({
          id: "project-1",
          workspaceId: "workspace-1",
          slug: "project-1-duplicate",
          name: "Duplicate ignored",
        })
        .onConflictDoNothing();

      const rows = await db.select().from(pgProjects).orderBy(pgProjects.id);
      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Roadmap", workspaceId: "workspace-1" }),
      ]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });

  it("injects scope-only predicates for strict-false Postgres bulk updates and deletes", async () => {
    const db = await createPgIntegrationDb();
    try {
      await seedPgProjects(db);
      const scopedDb = createScopedPgDb(db);

      const updatedRows = await scopedDb
        .update(pgProjects)
        .set({ name: "Bulk updated" })
        .where(undefined)
        .returning();
      expect(updatedRows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Bulk updated" }),
      ]);

      const [otherWorkspaceAfterUpdate] = await db
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-2"));
      expect(otherWorkspaceAfterUpdate?.name).toBe("Other workspace");

      const deletedRows = await scopedDb.delete(pgProjects).where(undefined).returning();
      expect(deletedRows).toEqual([expect.objectContaining({ id: "project-1" })]);

      const remainingRows = await db.select().from(pgProjects).orderBy(pgProjects.id);
      expect(remainingRows).toEqual([
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
      ]);
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
      expect(() => (updateResult as unknown as { $dynamic(): unknown }).$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

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

      const returnedUpdateResult = scopedDb
        .update(pgProjects)
        .set({ name: "Returned guarded" })
        .where(eq(pgProjects.slug, "project-1"))
        .returning() as unknown as { where(condition: unknown): unknown; $dynamic(): unknown };
      expect(() => returnedUpdateResult.where(eq(pgProjects.slug, "project-2"))).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );
      expect(() => returnedUpdateResult.$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

      const deletedRows = await scopedDb
        .delete(pgProjects)
        .where(eq(pgProjects.slug, "project-2"))
        .returning();
      expect(deletedRows).toEqual([]);

      const deleteResult = scopedDb
        .delete(pgProjects)
        .where(eq(pgProjects.slug, "project-1")) as unknown as {
        where(condition: unknown): unknown;
        $dynamic(): unknown;
      };
      expect(() => deleteResult.where(eq(pgProjects.slug, "project-2"))).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );
      expect(() => deleteResult.$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

      const returnedDeleteResult = scopedDb
        .delete(pgProjects)
        .where(eq(pgProjects.slug, "project-2"))
        .returning() as unknown as { where(condition: unknown): unknown; $dynamic(): unknown };
      expect(() => returnedDeleteResult.where(eq(pgProjects.slug, "project-1"))).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );
      expect(() => returnedDeleteResult.$dynamic()).toThrow(
        "Scoped mutation results do not expose raw query-builder chaining.",
      );

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

      const scopedUpsertResult = scopedDb
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
        });
      expect(() =>
        (scopedUpsertResult as unknown as { where(condition: unknown): unknown }).where(
          eq(pgProjects.id, "project-2"),
        ),
      ).toThrow();
      expect(() => (scopedUpsertResult as unknown as { $dynamic(): unknown }).$dynamic()).toThrow();
      const unsafeInsertBuilder = scopedDb
        .insert(pgProjects)
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
        await tx.insert(pgProjects).values({
          id: "project-3",
          workspaceId: "workspace-1",
          slug: "project-3",
          name: "Inserted in tx",
        });
        const crossScopeUpsertRows = await tx
          .insert(pgProjects)
          .values({
            id: "project-2",
            workspaceId: "workspace-1",
            slug: "project-2-tx-upsert",
            name: "Cross-scope tx upsert",
          })
          .onConflictDoUpdate({
            target: pgProjects.id,
            set: { name: "Cross-scope tx upsert" },
          })
          .returning();
        expect(crossScopeUpsertRows).toEqual([]);
      });

      const rows = await db.select().from(pgProjects).orderBy(pgProjects.id);
      expect(rows).toEqual([
        expect.objectContaining({ id: "project-1", name: "Updated in tx" }),
        expect.objectContaining({ id: "project-2", name: "Other workspace" }),
        expect.objectContaining({ id: "project-3", name: "Inserted in tx" }),
      ]);

      await expect(
        scopedDb.transaction(async (tx) => {
          await tx.insert(pgProjects).values({
            id: "project-4",
            workspaceId: "workspace-1",
            slug: "project-4",
            name: "Rolled back",
          });
          await tx._unsafeUnscopedDb.execute(sql`select boom from missing_table`);
        }),
      ).rejects.toThrow();

      const rolledBackRows = await db
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-4"));
      expect(rolledBackRows).toEqual([]);

      await expect(
        scopedDb.transaction(async (tx) => {
          await tx.insert(pgProjects).values({
            id: "project-5",
            workspaceId: "workspace-1",
            slug: "project-5",
            name: "Rolled back before invalid insert",
          });
          tx.insert(pgProjects).values({
            id: "project-6",
            workspaceId: "workspace-2",
            slug: "project-6",
            name: "Invalid tx insert",
          });
        }),
      ).rejects.toThrow(InvalidScopedInsertError);

      const invalidInsertRollbackRows = await db
        .select()
        .from(pgProjects)
        .where(eq(pgProjects.id, "project-5"));
      expect(invalidInsertRollbackRows).toEqual([]);
    } finally {
      await closePgIntegrationDb(db);
    }
  });
});
