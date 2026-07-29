import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const initialVersion = "001_lb_initial";
const attachmentsVersion = "002_lb_artifact_content";
const heartbeatVersion = "003_lb_worker_heartbeat";
async function migrate() {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(732019)");
    await client.query("CREATE TABLE IF NOT EXISTS lb_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [initialVersion]);
    if (!applied.rowCount) {
      const sql = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [initialVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${initialVersion} aplicada`);
    }
    const attachmentsApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [attachmentsVersion]);
    if (!attachmentsApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lb_artifacts ADD COLUMN IF NOT EXISTS content bytea");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [attachmentsVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${attachmentsVersion} aplicada`);
    }
    const heartbeatApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [heartbeatVersion]);
    if (!heartbeatApplied.rowCount) {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE IF NOT EXISTS lb_worker_heartbeats (
        worker_id text PRIMARY KEY,
        last_seen timestamptz NOT NULL DEFAULT now(),
        codex_authenticated boolean NOT NULL DEFAULT false,
        status_message text
      )`);
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [heartbeatVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${heartbeatVersion} aplicada`);
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
