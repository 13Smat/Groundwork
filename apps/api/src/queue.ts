import { PgBoss } from "pg-boss";

/**
 * pg-boss migrates its own schema, so it uses the database owner connection.
 * That role bypasses row security. Tenant work in a job must use the app pool
 * and `withWorkspaceContext`, not this connection. ADR 0005.
 */
export async function startQueue(
  databaseUrl: string,
  onError: (error: Error) => void,
): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl });
  boss.on("error", onError);
  await boss.start();
  return boss;
}
