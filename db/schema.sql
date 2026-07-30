CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE lb_ticket_status AS ENUM ('open','analyzing','fixing','testing','approval','completed','failed','cancelled');
CREATE TYPE lb_priority AS ENUM ('low','medium','high','critical');

CREATE TABLE lb_repository_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'github',
  installation_id bigint,
  account_login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES lb_repository_connections(id),
  github_repo_id bigint NOT NULL UNIQUE,
  name text NOT NULL,
  full_name text NOT NULL UNIQUE,
  default_branch text NOT NULL,
  language text,
  clone_url text NOT NULL,
  install_command text,
  test_command text,
  lint_command text,
  build_command text,
  deploy_webhook_url text,
  deploy_verification_url text,
  deploy_timeout_minutes smallint NOT NULL DEFAULT 20 CHECK (deploy_timeout_minutes BETWEEN 1 AND 120),
  test_environment jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_tickets (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES lb_applications(id),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (length(description) >= 10),
  priority lb_priority NOT NULL DEFAULT 'medium',
  queue_priority smallint NOT NULL DEFAULT 5 CHECK (queue_priority BETWEEN 1 AND 10),
  status lb_ticket_status NOT NULL DEFAULT 'open',
  branch_name text,
  base_commit text,
  result_summary text,
  cancellation_requested boolean NOT NULL DEFAULT false,
  auto_commit boolean NOT NULL DEFAULT true,
  auto_push boolean NOT NULL DEFAULT true,
  auto_pull_request boolean NOT NULL DEFAULT false,
  auto_deploy boolean NOT NULL DEFAULT false,
  create_tag boolean NOT NULL DEFAULT false,
  release_tag text,
  archived_at timestamptz,
  deploy_status text NOT NULL DEFAULT 'not_requested',
  deploy_updated_at timestamptz,
  deploy_expected_commit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL REFERENCES lb_tickets(id),
  application_id uuid NOT NULL REFERENCES lb_applications(id),
  state text NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 1,
  worker_id text,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  resume_artifact_id uuid,
  UNIQUE(ticket_id, attempt)
);
CREATE UNIQUE INDEX lb_one_active_execution_per_app ON lb_executions(application_id)
  WHERE state='running';
CREATE TABLE lb_events (
  id bigserial PRIMARY KEY,
  ticket_id bigint NOT NULL REFERENCES lb_tickets(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES lb_executions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL REFERENCES lb_tickets(id),
  execution_id uuid NOT NULL REFERENCES lb_executions(id),
  reason text NOT NULL,
  decision text CHECK (decision IN ('approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL REFERENCES lb_tickets(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  storage_key text NOT NULL,
  mime_type text,
  size_bytes bigint,
  content bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now(),
  codex_authenticated boolean NOT NULL DEFAULT false,
  status_message text
);
CREATE TABLE lb_worker_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  queue_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  deploy_ticket_id bigint REFERENCES lb_tickets(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lb_worker_control(singleton) VALUES(true);
CREATE TABLE lb_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  archive_after_days smallint NOT NULL DEFAULT 7 CHECK (archive_after_days BETWEEN 1 AND 3650),
  delete_after_days smallint NOT NULL DEFAULT 15 CHECK (delete_after_days BETWEEN 2 AND 3650),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (delete_after_days > archive_after_days)
);
INSERT INTO lb_settings(singleton) VALUES(true);
