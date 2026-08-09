import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const initialVersion = "001_lb_initial";
const attachmentsVersion = "002_lb_artifact_content";
const heartbeatVersion = "003_lb_worker_heartbeat";
const automationOptionsVersion = "004_lb_automation_options";
const releaseTagsVersion = "005_lb_release_tags";
const approvalResumeVersion = "006_lb_approval_resume";
const queuePriorityVersion = "007_lb_queue_priority";
const workerPauseVersion = "008_lb_worker_pause";
const settingsVersion = "009_lb_settings_retention_and_environment";
const workforceRenameVersion = "010_lwf_rename";
const workforceSchemaVersion = "011_lwf_schema";
const shadowCleanupVersion = "012_lwf_shadow_cleanup";
const deployMonitoringVersion = "013_lwf_deploy_monitoring";
const applicationContextVersion = "014_lwf_application_context";
const ticketModelVersion = "015_lwf_ticket_ai_model";
const scheduledDeployTicketsVersion = "016_lwf_scheduled_deploy_tickets";
const cleanupRequestsVersion = "017_lwf_cleanup_requests";
async function migrate() {
  const client = await db.connect();
  try {
    // Migrations always resolve the compatibility objects in public. Once the
    // dedicated schema exists, an unqualified CREATE would otherwise create a
    // second, empty lb_migrations table that hides the real history.
    await client.query("SET search_path TO public");
    await client.query("SELECT pg_advisory_lock(732019)");
    await client.query("CREATE TABLE IF NOT EXISTS public.lb_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
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
    const queuePriorityApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [queuePriorityVersion]);
    if (!queuePriorityApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS queue_priority smallint NOT NULL DEFAULT 5 CHECK (queue_priority BETWEEN 1 AND 10)");
      await client.query("DROP INDEX IF EXISTS lb_one_active_execution_per_app");
      await client.query("CREATE UNIQUE INDEX lb_one_active_execution_per_app ON lb_executions(application_id) WHERE state='running'");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [queuePriorityVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${queuePriorityVersion} aplicada`);
    }
    const workerPauseApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [workerPauseVersion]);
    if (!workerPauseApplied.rowCount) {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE IF NOT EXISTS lb_worker_control (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        queue_paused boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query("INSERT INTO lb_worker_control(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [workerPauseVersion]);
      await client.query("COMMIT");
      console.log(`Migração ${workerPauseVersion} aplicada`);
    }
    const settingsApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [settingsVersion]);
    if (!settingsApplied.rowCount) {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE IF NOT EXISTS lb_settings (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        archive_after_days smallint NOT NULL DEFAULT 7 CHECK (archive_after_days BETWEEN 1 AND 3650),
        delete_after_days smallint NOT NULL DEFAULT 15 CHECK (delete_after_days BETWEEN 2 AND 3650),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (delete_after_days > archive_after_days)
      )`);
      await client.query("INSERT INTO lb_settings(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING");
      await client.query("ALTER TABLE lb_applications ADD COLUMN IF NOT EXISTS test_environment jsonb NOT NULL DEFAULT '{}'");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS archived_at timestamptz");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS deploy_status text NOT NULL DEFAULT 'not_requested'");
      await client.query("ALTER TABLE lb_tickets ADD COLUMN IF NOT EXISTS deploy_updated_at timestamptz");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [settingsVersion]);
      await client.query("COMMIT");
    }
    const workforceRenameApplied = await client.query("SELECT 1 FROM lb_migrations WHERE version=$1", [workforceRenameVersion]);
    if (!workforceRenameApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("INSERT INTO lb_migrations(version) VALUES($1)", [workforceRenameVersion]);
      await client.query("ALTER TABLE lb_repository_connections RENAME TO lwf_repository_connections");
      await client.query("ALTER TABLE lb_applications RENAME TO lwf_applications");
      await client.query("ALTER TABLE lb_tickets RENAME TO lwf_tickets");
      await client.query("ALTER TABLE lb_executions RENAME TO lwf_executions");
      await client.query("ALTER TABLE lb_events RENAME TO lwf_events");
      await client.query("ALTER TABLE lb_approvals RENAME TO lwf_approvals");
      await client.query("ALTER TABLE lb_artifacts RENAME TO lwf_artifacts");
      await client.query("ALTER TABLE lb_worker_heartbeats RENAME TO lwf_worker_heartbeats");
      await client.query("ALTER TABLE lb_worker_control RENAME TO lwf_worker_control");
      await client.query("ALTER TABLE IF EXISTS lb_cleanup_requests RENAME TO lwf_cleanup_requests");
      await client.query("ALTER TABLE lb_settings RENAME TO lwf_settings");
      await client.query("ALTER INDEX IF EXISTS lb_one_active_execution_per_app RENAME TO lwf_one_active_execution_per_app");
      await client.query("ALTER SEQUENCE IF EXISTS lb_tickets_id_seq RENAME TO lwf_tickets_id_seq");
      await client.query("ALTER SEQUENCE IF EXISTS lb_events_id_seq RENAME TO lwf_events_id_seq");
      await client.query(`DO $$ DECLARE item record; BEGIN
        FOR item IN
          SELECT table_name,constraint_name
          FROM information_schema.table_constraints
          WHERE table_schema='public' AND table_name LIKE 'lwf_%' AND constraint_name LIKE 'lb_%'
        LOOP
          EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
            item.table_name,item.constraint_name,regexp_replace(item.constraint_name,'^lb_','lwf_'));
        END LOOP;
      END $$`);
      await client.query("ALTER TYPE lb_ticket_status RENAME TO lwf_ticket_status");
      await client.query("ALTER TYPE lb_priority RENAME TO lwf_priority");
      await client.query(`DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='lionban_test')
          AND NOT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='lionworkforce_test')
        THEN EXECUTE 'ALTER SCHEMA lionban_test RENAME TO lionworkforce_test';
        END IF;
      END $$`);
      await client.query("ALTER TABLE lb_migrations RENAME TO lwf_migrations");
      await client.query("CREATE VIEW lb_migrations AS SELECT * FROM lwf_migrations");
      await client.query("CREATE VIEW lb_repository_connections AS SELECT * FROM lwf_repository_connections");
      await client.query("CREATE VIEW lb_applications AS SELECT * FROM lwf_applications");
      await client.query("CREATE VIEW lb_tickets AS SELECT * FROM lwf_tickets");
      await client.query("CREATE VIEW lb_executions AS SELECT * FROM lwf_executions");
      await client.query("CREATE VIEW lb_events AS SELECT * FROM lwf_events");
      await client.query("CREATE VIEW lb_approvals AS SELECT * FROM lwf_approvals");
      await client.query("CREATE VIEW lb_artifacts AS SELECT * FROM lwf_artifacts");
      await client.query("CREATE VIEW lb_worker_heartbeats AS SELECT * FROM lwf_worker_heartbeats");
      await client.query("CREATE VIEW lb_worker_control AS SELECT * FROM lwf_worker_control");
      await client.query("CREATE VIEW lb_cleanup_requests AS SELECT * FROM lwf_cleanup_requests");
      await client.query("CREATE VIEW lb_settings AS SELECT * FROM lwf_settings");
      await client.query("COMMIT");
    }
    const workforceSchemaApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [workforceSchemaVersion]);
    if (!workforceSchemaApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA IF NOT EXISTS lionworkforce AUTHORIZATION CURRENT_USER");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [workforceSchemaVersion]);
      for (const table of [
        "lwf_repository_connections","lwf_applications","lwf_tickets","lwf_executions",
        "lwf_events","lwf_approvals","lwf_artifacts","lwf_worker_heartbeats",
        "lwf_worker_control","lwf_cleanup_requests","lwf_settings","lwf_migrations",
      ]) {
        await client.query(`ALTER TABLE IF EXISTS public.${table} SET SCHEMA lionworkforce`);
      }
      await client.query("ALTER SEQUENCE IF EXISTS public.lwf_tickets_id_seq SET SCHEMA lionworkforce");
      await client.query("ALTER SEQUENCE IF EXISTS public.lwf_events_id_seq SET SCHEMA lionworkforce");
      await client.query("ALTER TYPE public.lwf_ticket_status SET SCHEMA lionworkforce");
      await client.query("ALTER TYPE public.lwf_priority SET SCHEMA lionworkforce");
      await client.query("COMMIT");
    }
    const shadowCleanupApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [shadowCleanupVersion]);
    if (!shadowCleanupApplied.rowCount) {
      await client.query("BEGIN");
      await client.query(`DO $$ DECLARE item text; amount bigint; BEGIN
        FOREACH item IN ARRAY ARRAY[
          'lb_repository_connections','lb_applications','lb_tickets','lb_executions',
          'lb_events','lb_approvals','lb_artifacts'
        ] LOOP
          IF to_regclass('lionworkforce.' || item) IS NOT NULL THEN
            EXECUTE format('SELECT count(*) FROM lionworkforce.%I',item) INTO amount;
            IF amount > 0 THEN
              RAISE EXCEPTION 'LEGACY_SHADOW_NOT_EMPTY: lionworkforce.% contains % row(s)',item,amount;
            END IF;
          END IF;
        END LOOP;
      END $$`);
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_events CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_approvals CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_artifacts CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_executions CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_tickets CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_applications CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_repository_connections CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_worker_heartbeats CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_worker_control CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_settings CASCADE");
      await client.query("DROP TABLE IF EXISTS lionworkforce.lb_migrations CASCADE");
      await client.query("DROP TYPE IF EXISTS lionworkforce.lb_ticket_status CASCADE");
      await client.query("DROP TYPE IF EXISTS lionworkforce.lb_priority CASCADE");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [shadowCleanupVersion]);
      await client.query("COMMIT");
    }
    const deployMonitoringApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [deployMonitoringVersion]);
    if (!deployMonitoringApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lionworkforce.lwf_applications ADD COLUMN IF NOT EXISTS deploy_verification_url text");
      await client.query("ALTER TABLE lionworkforce.lwf_applications ADD COLUMN IF NOT EXISTS deploy_timeout_minutes smallint NOT NULL DEFAULT 20 CHECK (deploy_timeout_minutes BETWEEN 1 AND 120)");
      await client.query("ALTER TABLE lionworkforce.lwf_tickets ADD COLUMN IF NOT EXISTS deploy_expected_commit text");
      await client.query("ALTER TABLE lionworkforce.lwf_worker_control ADD COLUMN IF NOT EXISTS pause_reason text");
      await client.query("ALTER TABLE lionworkforce.lwf_worker_control ADD COLUMN IF NOT EXISTS deploy_ticket_id bigint REFERENCES lionworkforce.lwf_tickets(id) ON DELETE SET NULL");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [deployMonitoringVersion]);
      await client.query("COMMIT");
    }
    const applicationContextApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [applicationContextVersion]);
    if (!applicationContextApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lionworkforce.lwf_applications ADD COLUMN IF NOT EXISTS project_context text NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE lionworkforce.lwf_applications ADD COLUMN IF NOT EXISTS technical_history text NOT NULL DEFAULT ''");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [applicationContextVersion]);
      await client.query("COMMIT");
    }
    const ticketModelApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [ticketModelVersion]);
    if (!ticketModelApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lionworkforce.lwf_tickets ADD COLUMN IF NOT EXISTS ai_model text");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [ticketModelVersion]);
      await client.query("COMMIT");
    }
    const scheduledDeployTicketsApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [scheduledDeployTicketsVersion]);
    if (!scheduledDeployTicketsApplied.rowCount) {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lionworkforce.lwf_tickets ADD COLUMN IF NOT EXISTS ticket_kind text NOT NULL DEFAULT 'fix'");
      await client.query("ALTER TABLE lionworkforce.lwf_tickets ADD COLUMN IF NOT EXISTS scheduled_at timestamptz");
      await client.query("ALTER TABLE lionworkforce.lwf_tickets DROP CONSTRAINT IF EXISTS lwf_tickets_ticket_kind_check");
      await client.query("ALTER TABLE lionworkforce.lwf_tickets ADD CONSTRAINT lwf_tickets_ticket_kind_check CHECK (ticket_kind IN ('fix','deploy'))");
      await client.query("CREATE INDEX IF NOT EXISTS lwf_scheduled_queue ON lionworkforce.lwf_tickets(scheduled_at) WHERE status='open'");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [scheduledDeployTicketsVersion]);
      await client.query("COMMIT");
    }
    const cleanupRequestsApplied = await client.query("SELECT 1 FROM public.lb_migrations WHERE version=$1", [cleanupRequestsVersion]);
    if (!cleanupRequestsApplied.rowCount) {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE IF NOT EXISTS lionworkforce.lwf_cleanup_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id uuid NOT NULL REFERENCES lionworkforce.lwf_applications(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
        removed_directories integer NOT NULL DEFAULT 0,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      )`);
      await client.query("CREATE INDEX IF NOT EXISTS lwf_cleanup_requests_pending ON lionworkforce.lwf_cleanup_requests(created_at) WHERE status='pending'");
      await client.query("INSERT INTO public.lb_migrations(version) VALUES($1)", [cleanupRequestsVersion]);
      await client.query("COMMIT");
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
