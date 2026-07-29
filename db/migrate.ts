import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const version = "001_initial";
async function migrate() {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(732019)");
    await client.query("CREATE TABLE IF NOT EXISTS lionban_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT 1 FROM lionban_migrations WHERE version=$1", [version]);
    if (!applied.rowCount) {
      const sql = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO lionban_migrations(version) VALUES($1)", [version]);
      await client.query("COMMIT");
      console.log(`Migração ${version} aplicada`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(732019)").catch(() => undefined);
    client.release();
    await db.end();
  }
}
migrate().catch(error => { console.error(error); process.exit(1); });
