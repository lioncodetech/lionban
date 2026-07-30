import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const initialVersion = "001_lb_initial";
const attachmentsVersion = "002_lb_artifact_content";
const heartbeatVersion = "003_lb_worker_heartbeat";
const automationOptionsVersion = "004_lb_automation_options";
const releaseTagsVersion = "005_lb_release_tags";
const approvalResumeVersion = "006_lb_approval_resume";
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
    const automationOptionsApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [automationOptionsVersion]);
    if (!automationOptionsApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lb_applications ADD COLUMN IF NOT EXISTS deploy_webhook_url text");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS auto_commit boolean NOT NULL DEFAULT true");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS auto_push boolean NOT NULL DEFAULT true");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS auto_pull_request boolean NOT NULL DEFAULT false");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS auto_deploy boolean NOT NULL DEFAULT false");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [automationOptionsVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${automationOptionsVersion} aplicada`);
    }
    const releaseTagsApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [releaseTagsVersion]);
    if (!releaseTagsApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS create_tag boolean NOT NULL DEFAULT false");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS release_tag text");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [releaseTagsVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${releaseTagsVersion} aplicada`);
    }
    const approvalResumeApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [approvalResumeVersion]);
    if (!approvalResumeApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lb_executions ADD COLUMN IF NOT EXISTS resume_artifact_id uuid REFERENCES lb_artifacts(id) ON DELETE SET NULL");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [approvalResumeVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${approvalResumeVersion} aplicada`);
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
