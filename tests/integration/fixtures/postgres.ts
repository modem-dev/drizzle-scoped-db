import { PGlite } from "@electric-sql/pglite";
import { type SQL, sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const pgProjects = pgTable(
  "integration_projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    regionId: text("region_id"),
  },
  (table) => [uniqueIndex("integration_projects_slug_unique").on(table.slug)],
);

export type PgIntegrationDb = PgliteDatabase<Record<string, never>> & { $client: PGlite };

const PROJECTS_DDL = `
    create table integration_projects (
      id text primary key,
      workspace_id text not null,
      slug text not null unique,
      name text not null,
      region_id text
    );
  `;

export async function createPgIntegrationDb(): Promise<PgIntegrationDb> {
  const client = new PGlite();
  const db = drizzle({ client });

  await db.execute(sql.raw(PROJECTS_DDL));

  return db;
}

/**
 * Relational-query schema whose KEY (the Drizzle `tsName`) deliberately differs from the table's
 * SQL name (`integration_projects`). Drizzle's relational query API aliases callback columns to
 * this key, mirroring real consumer schemas like `{ groupsTbl: pgTable("groups", ...) }`.
 */
export const pgRelationalSchema = { projectsTbl: pgProjects };

/**
 * Minimal relational-query surface the regression test needs, typed locally so the fixture builds
 * across Drizzle's locked and release-candidate dependency matrices (the relational-query generics
 * differ between versions). The runtime method is still Drizzle's own.
 */
export type PgRelationalDb = PgIntegrationDb & {
  query: {
    projectsTbl: {
      findMany(config: {
        where: (
          columns: { id: unknown; workspaceId: unknown },
          operators: { eq: (left: unknown, right: unknown) => SQL },
        ) => SQL | undefined;
      }): Promise<Array<typeof pgProjects.$inferSelect>>;
    };
  };
};

export type PgRqbV2RelationalDb = PgIntegrationDb & {
  query: {
    projectsTbl: {
      findMany(config?: {
        where?: Record<string, unknown>;
      }): Promise<Array<typeof pgProjects.$inferSelect>>;
    };
  };
};

export async function createPgRelationalDb(): Promise<PgRelationalDb> {
  const client = new PGlite();
  // Cast through the bare drizzle signature: the typed schema overload differs across Drizzle
  // versions, but the runtime relational query API is the same. The returned db is given the
  // explicit PgRelationalDb shape above.
  const makeDb = drizzle as unknown as (config: {
    client: PGlite;
    schema: typeof pgRelationalSchema;
  }) => PgIntegrationDb;
  const db = makeDb({ client, schema: pgRelationalSchema });

  await db.execute(sql.raw(PROJECTS_DDL));

  return db as unknown as PgRelationalDb;
}

export async function createPgRqbV2RelationalDb(): Promise<PgRqbV2RelationalDb> {
  const relationsModule = (await import("drizzle-orm/relations")) as Record<string, unknown>;
  const defineRelations = relationsModule.defineRelations as
    | ((schema: typeof pgRelationalSchema, relations: () => Record<string, never>) => unknown)
    | undefined;
  if (!defineRelations) {
    throw new Error("Drizzle RQBv2 defineRelations is not available.");
  }

  const client = new PGlite();
  const makeDb = drizzle as unknown as (config: {
    client: PGlite;
    relations: unknown;
  }) => PgIntegrationDb;
  const db = makeDb({ client, relations: defineRelations(pgRelationalSchema, () => ({})) });

  await db.execute(sql.raw(PROJECTS_DDL));

  return db as unknown as PgRqbV2RelationalDb;
}

export async function seedPgProjects(db: Pick<PgIntegrationDb, "insert">): Promise<void> {
  await db.insert(pgProjects).values([
    {
      id: "project-1",
      workspaceId: "workspace-1",
      slug: "project-1",
      name: "Roadmap",
      regionId: "us-east-1",
    },
    {
      id: "project-2",
      workspaceId: "workspace-2",
      slug: "project-2",
      name: "Other workspace",
      regionId: "us-west-2",
    },
  ]);
}

export async function closePgIntegrationDb(db: Pick<PgIntegrationDb, "$client">): Promise<void> {
  await db.$client.close();
}
