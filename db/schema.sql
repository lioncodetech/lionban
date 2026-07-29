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
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lb_tickets (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES lb_applications(id),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (length(description) >= 10),
  priority lb_priority NOT NULL DEFAULT 'medium',
  status lb_ticket_status NOT NULL DEFAULT 'open',
  branch_name text,
  base_commit text,
  result_summary text,
  cancellation_requested boolean NOT NULL DEFAULT false,
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
  UNIQUE(ticket_id, attempt)
);
CREATE UNIQUE INDEX lb_one_active_execution_per_app ON lb_executions(application_id)
  WHERE state IN ('queued','running');
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
