import {
  eq,
  containsColumnFilter,
  createScopedDb,
  defineScopedTable,
  InvalidScopedConflictTargetError,
  InvalidScopedInsertError,
  InvalidScopedUpdateError,
  MissingScopedPredicateError,
  MissingScopedWhereError,
  scopeByColumn,
  projectsTbl,
  createFakeDb,
  type SQL,
} from "./fixtures";

describe("createScopedDb mutation guardrails", () => {
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

  it("validates update payloads when an insertKey is declared as a fallback for updateKey", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    // Valid: updating a non-scope column
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ name: "Updated Roadmap" })
        .where(eq(projectsTbl.id, "project-1")),
    ).not.toThrow();

    // Valid: updating the scope column to the matching scope value
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ workspaceId: "workspace-1" })
        .where(eq(projectsTbl.id, "project-1")),
    ).not.toThrow();

    // Invalid: updating the scope column to a different scope value
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ workspaceId: "workspace-2" })
        .where(eq(projectsTbl.id, "project-1")),
    ).toThrow(InvalidScopedUpdateError);
  });

  it("validates update payloads when a custom updateKey is declared", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [
        scopeByColumn(projectsTbl, projectsTbl.workspaceId, {
          insertKey: "workspaceId",
          updateKey: "customWorkspaceKey",
        }),
      ],
    });

    // Valid: customWorkspaceKey matches scope value
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ customWorkspaceKey: "workspace-1" } as Partial<typeof projectsTbl.$inferInsert>)
        .where(eq(projectsTbl.id, "project-1")),
    ).not.toThrow();

    // Invalid: customWorkspaceKey has different scope value
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ customWorkspaceKey: "workspace-2" } as Partial<typeof projectsTbl.$inferInsert>)
        .where(eq(projectsTbl.id, "project-1")),
    ).toThrow(InvalidScopedUpdateError);

    // Valid: insertKey is ignored for updates when updateKey is declared
    expect(() =>
      scopedDb
        .update(projectsTbl)
        .set({ workspaceId: "workspace-2" })
        .where(eq(projectsTbl.id, "project-1")),
    ).not.toThrow();
  });

  it("enforces strict where validation on scoped update and delete", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: true,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    expect(() => scopedDb.update(projectsTbl).set({ name: "Updated" }).where(undefined)).toThrow(
      MissingScopedWhereError,
    );
    expect(() =>
      scopedDb.update(projectsTbl).set({ name: "Updated" }).where(eq(projectsTbl.id, "p1")),
    ).toThrow(MissingScopedPredicateError);
    expect(() => scopedDb.delete(projectsTbl).where(undefined)).toThrow(MissingScopedWhereError);
    expect(() => scopedDb.delete(projectsTbl).where(eq(projectsTbl.id, "p1"))).toThrow(
      MissingScopedPredicateError,
    );

    scopedDb
      .update(projectsTbl)
      .set({ name: "Updated" })
      .where(eq(projectsTbl.workspaceId, "workspace-1"));
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id")).toBe(true);
    scopedDb.delete(projectsTbl).where(eq(projectsTbl.workspaceId, "workspace-1"));
    expect(containsColumnFilter(rawDb._state.deleteCondition, "workspace_id")).toBe(true);
  });

  it("prevents double .where() on scoped update results", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    const result = scopedDb
      .update(projectsTbl)
      .set({ name: "Updated" })
      .where(eq(projectsTbl.id, "project-1")) as unknown as {
      where: (condition: SQL | undefined) => unknown;
      $dynamic: () => unknown;
    };

    expect(() => result.where(eq(projectsTbl.id, "project-2"))).toThrow();
    expect(() => result.$dynamic()).toThrow();
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect((result as { constructor?: unknown }).constructor).toBeUndefined();
    expect((result as { valueOf?: unknown }).valueOf).toBeUndefined();
    expect((result as { __defineGetter__?: unknown }).__defineGetter__).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(result, "where")).toBeUndefined();
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id")).toBe(true);
  });

  it("allows awaiting scoped update and delete results as promises", async () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    const updateResult = await scopedDb
      .update(projectsTbl)
      .set({ name: "Updated" })
      .where(eq(projectsTbl.id, "project-1"));
    expect(updateResult).toEqual({
      condition: rawDb._state.updateCondition,
      values: { name: "Updated" },
      where: expect.any(Function),
      returning: expect.any(Function),
      $dynamic: expect.any(Function),
    });

    const deleteResult = await scopedDb.delete(projectsTbl).where(eq(projectsTbl.id, "project-1"));
    expect(deleteResult).toEqual({
      condition: rawDb._state.deleteCondition,
      where: expect.any(Function),
      returning: expect.any(Function),
      $dynamic: expect.any(Function),
    });
  });

  it("keeps scoped update and delete results guarded after returning()", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    const updateResult = scopedDb
      .update(projectsTbl)
      .set({ name: "Updated" })
      .where(eq(projectsTbl.id, "project-1"))
      .returning() as unknown as { where(condition: SQL | undefined): unknown };
    expect(() => updateResult.where(eq(projectsTbl.id, "project-2"))).toThrow();
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id")).toBe(true);

    const deleteResult = scopedDb
      .delete(projectsTbl)
      .where(eq(projectsTbl.id, "project-1"))
      .returning() as unknown as { where(condition: SQL | undefined): unknown };
    expect(() => deleteResult.where(eq(projectsTbl.id, "project-2"))).toThrow();
    expect(containsColumnFilter(rawDb._state.deleteCondition, "workspace_id")).toBe(true);
  });

  it("prevents double .where() on scoped delete results", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const result = scopedDb
      .delete(projectsTbl)
      .where(eq(projectsTbl.id, "project-1")) as unknown as {
      where: (condition: SQL | undefined) => unknown;
      $dynamic: () => unknown;
    };

    expect(() => result.where(eq(projectsTbl.id, "project-2"))).toThrow();
    expect(() => result.$dynamic()).toThrow();
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect((result as { constructor?: unknown }).constructor).toBeUndefined();
    expect((result as { valueOf?: unknown }).valueOf).toBeUndefined();
    expect((result as { __defineGetter__?: unknown }).__defineGetter__).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(result, "where")).toBeUndefined();
    expect(containsColumnFilter(rawDb._state.deleteCondition, "workspace_id")).toBe(true);
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

    expect(() =>
      scopedDbWithInsertValidation.insert(projectsTbl).values([
        { id: "project-4", workspaceId: "workspace-1", name: "Valid" },
        { id: "project-5", workspaceId: "workspace-2", name: "Wrong" },
      ]),
    ).toThrow(InvalidScopedInsertError);
    expect(rawDb._state.insertValues).toEqual([
      { id: "project-2", workspaceId: "workspace-1", name: "One" },
      { id: "project-3", workspaceId: "workspace-1", name: "Two" },
    ]);
  });

  it("supports scoped Postgres-style upserts on non-scope conflict targets by injecting setWhere", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    const targetWhere = eq(projectsTbl.regionId, "region-1");
    const config = {
      target: projectsTbl.id,
      targetWhere,
      set: { name: "Updated" },
    };

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .onConflictDoUpdate(config)
      .returning();
    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-2", workspaceId: "workspace-1", name: "Backlog" })
      .onConflictDoNothing();

    const conflictConfig = rawDb._state.conflictConfig as typeof config & { setWhere?: SQL };
    expect(conflictConfig).not.toBe(config);
    expect(conflictConfig.target).toBe(projectsTbl.id);
    expect(conflictConfig.targetWhere).toBe(targetWhere);
    expect(conflictConfig.set).toBe(config.set);
    expect(conflictConfig.setWhere).toBeDefined();
    expect(containsColumnFilter(conflictConfig.setWhere, "workspace_id", projectsTbl)).toBe(true);
    expect(rawDb._state.conflictDidNothing).toBe(true);
  });

  it("combines caller-supplied upsert setWhere with the scope guard", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });
    const callerSetWhere = eq(projectsTbl.name, "Draft");

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .onConflictDoUpdate({
        target: projectsTbl.id,
        set: { name: "Updated" },
        setWhere: callerSetWhere,
      });

    const conflictConfig = rawDb._state.conflictConfig as { setWhere?: SQL };
    expect(conflictConfig.setWhere).toBeDefined();
    expect(conflictConfig.setWhere).not.toBe(callerSetWhere);
    expect(containsColumnFilter(conflictConfig.setWhere, "name", projectsTbl)).toBe(true);
    expect(containsColumnFilter(conflictConfig.setWhere, "workspace_id", projectsTbl)).toBe(true);
  });

  it("folds deprecated upsert where into guarded setWhere", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });
    const legacyWhere = eq(projectsTbl.regionId, "region-1");

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .onConflictDoUpdate({
        target: projectsTbl.id,
        set: { name: "Updated" },
        where: legacyWhere,
      });

    const conflictConfig = rawDb._state.conflictConfig as { where?: SQL; setWhere?: SQL };
    expect("where" in conflictConfig).toBe(false);
    expect(conflictConfig.setWhere).toBeDefined();
    expect(containsColumnFilter(conflictConfig.setWhere, "region_id", projectsTbl)).toBe(true);
    expect(containsColumnFilter(conflictConfig.setWhere, "workspace_id", projectsTbl)).toBe(true);
  });

  it("injects setWhere even when the upsert conflict target already includes scope", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    const config = {
      target: [projectsTbl.workspaceId, projectsTbl.id],
      set: { name: "Updated" },
    };

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .onConflictDoUpdate(config);

    const conflictConfig = rawDb._state.conflictConfig as typeof config & { setWhere?: SQL };
    expect(conflictConfig.target).toBe(config.target);
    expect(conflictConfig.set).toBe(config.set);
    expect(conflictConfig.setWhere).toBeDefined();
    expect(containsColumnFilter(conflictConfig.setWhere, "workspace_id", projectsTbl)).toBe(true);
  });

  it("rejects scoped upserts with invalid configs, missing validators, or cross-scope set payloads", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
        .onConflictDoUpdate(null),
    ).toThrow(InvalidScopedConflictTargetError);

    const duplicateKeyInsert = scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" }) as unknown as {
      onDuplicateKeyUpdate(config: unknown): unknown;
    };
    expect(() => duplicateKeyInsert.onDuplicateKeyUpdate({ set: { name: "Updated" } })).toThrow(
      InvalidScopedConflictTargetError,
    );

    const scopedDbWithoutInsertValidation = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { updateKey: "workspaceId" })],
    });
    expect(() =>
      scopedDbWithoutInsertValidation
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-2", name: "Wrong" })
        .onConflictDoUpdate({
          target: [projectsTbl.workspaceId, projectsTbl.id],
          set: { name: "Updated" },
        }),
    ).toThrow(InvalidScopedConflictTargetError);

    const scopedDbWithoutScopeGuard = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [
        defineScopedTable<string, typeof projectsTbl>(projectsTbl, {
          where: () => undefined,
          validateInsert: () => true,
          validateUpdate: () => true,
        }),
      ],
    });
    expect(() =>
      scopedDbWithoutScopeGuard
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
        .onConflictDoUpdate({ target: projectsTbl.id, set: { name: "Updated" } }),
    ).toThrow(InvalidScopedConflictTargetError);

    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
        .onConflictDoUpdate({
          target: [projectsTbl.workspaceId, projectsTbl.id],
          set: { workspaceId: "workspace-2" },
        }),
    ).toThrow(InvalidScopedUpdateError);

    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
        .onConflictDoUpdate({ target: [projectsTbl.workspaceId, projectsTbl.id] }),
    ).toThrow(InvalidScopedUpdateError);
  });

  it("keeps scoped insert conflict guards after returning() and blocks unloud dynamic escape", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    const returned = scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .returning() as unknown as {
      onConflictDoUpdate(config: unknown): unknown;
      $dynamic(): unknown;
    };

    expect(() =>
      returned.onConflictDoUpdate({ target: projectsTbl.id, set: { workspaceId: "workspace-2" } }),
    ).toThrow(InvalidScopedUpdateError);
    expect(() => returned.$dynamic()).toThrow();
    expect(Object.getPrototypeOf(returned)).toBeNull();
    expect((returned as { constructor?: unknown }).constructor).toBeUndefined();
    expect((returned as { valueOf?: unknown }).valueOf).toBeUndefined();
    expect((returned as { __defineGetter__?: unknown }).__defineGetter__).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(returned, "onConflictDoUpdate")).toBeUndefined();
    expect(rawDb._state.conflictConfig).toBeUndefined();
  });

  it("exposes the raw insert builder via $unsafeUnscoped() only after scoped values validation runs", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });

    // The scoped result delegates non-function properties straight through to the raw builder.
    const scopedResult = scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" });
    expect((scopedResult as unknown as { values: unknown }).values).toEqual({
      id: "project-1",
      workspaceId: "workspace-1",
      name: "Roadmap",
    });

    // The escape returns the raw post-values() builder, where conflict chaining is available.
    const raw = scopedResult.$unsafeUnscoped();
    expect(typeof raw.onConflictDoUpdate).toBe("function");
    expect(raw.onConflictDoNothing()).toBe(raw);
    raw.onConflictDoUpdate({ target: projectsTbl.id, set: { workspaceId: "workspace-2" } });
    expect(rawDb._state.conflictConfig).toEqual({
      target: projectsTbl.id,
      set: { workspaceId: "workspace-2" },
    });
    expect(rawDb._state.insertValues).toEqual({
      id: "project-1",
      workspaceId: "workspace-1",
      name: "Roadmap",
    });

    // Scoped insert validation still runs first: an out-of-scope row throws before any escape.
    expect(() =>
      scopedDb
        .insert(projectsTbl)
        .values({ id: "project-2", workspaceId: "workspace-2", name: "Wrong" })
        .$unsafeUnscoped(),
    ).toThrow(InvalidScopedInsertError);
  });

  it("combines legacy upsert where and setWhere before adding the scope guard", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId, { insertKey: "workspaceId" })],
    });
    const legacyWhere = eq(projectsTbl.regionId, "region-1");
    const setWhere = eq(projectsTbl.name, "Draft");

    scopedDb
      .insert(projectsTbl)
      .values({ id: "project-1", workspaceId: "workspace-1", name: "Roadmap" })
      .onConflictDoUpdate({
        target: projectsTbl.id,
        set: { name: "Updated" },
        where: legacyWhere,
        setWhere,
      });

    const conflictConfig = rawDb._state.conflictConfig as { where?: SQL; setWhere?: SQL };
    expect("where" in conflictConfig).toBe(false);
    expect(conflictConfig.setWhere).toBeDefined();
    expect(containsColumnFilter(conflictConfig.setWhere, "region_id", projectsTbl)).toBe(true);
    expect(containsColumnFilter(conflictConfig.setWhere, "name", projectsTbl)).toBe(true);
    expect(containsColumnFilter(conflictConfig.setWhere, "workspace_id", projectsTbl)).toBe(true);
  });

  it("allows scoped updates without update validation when no update validator is declared", () => {
    const rawDb = createFakeDb();
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    const result = scopedDb
      .update(projectsTbl)
      .set({ workspaceId: "workspace-2" })
      .where(eq(projectsTbl.id, "project-1"));

    expect((result as unknown as { condition: SQL | undefined }).condition).toBe(
      rawDb._state.updateCondition,
    );
    expect(containsColumnFilter(rawDb._state.updateCondition, "workspace_id", projectsTbl)).toBe(
      true,
    );
  });

  it("returns non-object raw mutation results without proxy wrapping", () => {
    const rawDb = {
      ...createFakeDb(),
      update() {
        return {
          set() {
            return {
              where() {
                return "updated";
              },
            };
          },
        };
      },
    };
    const scopedDb = createScopedDb(rawDb, {
      scopeName: "workspace",
      scopeValue: "workspace-1",
      strict: false,
      rules: [scopeByColumn(projectsTbl, projectsTbl.workspaceId)],
    });

    expect(scopedDb.update(projectsTbl).set({ name: "Updated" }).where(undefined)).toBe("updated");
  });
});
