-- TCRMS core schema. Additive and isolated: does not drop, rename, or modify existing tables.
-- Apply this migration to the intended TCRMS database before enabling API traffic.
BEGIN;

CREATE TABLE IF NOT EXISTS tcrms_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(150) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('ADMIN','RECORDS_OFFICER','ANALYST','AUDITOR')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tcrms_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_reference VARCHAR(80) NOT NULL UNIQUE,
  full_name VARCHAR(200) NOT NULL,
  date_of_birth DATE,
  national_id_last4 VARCHAR(4),
  record_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (record_status IN ('PENDING','UNDER_REVIEW','VERIFIED','CLOSED')),
  summary TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES tcrms_users(id),
  updated_by UUID NOT NULL REFERENCES tcrms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tcrms_records_created_at_idx ON tcrms_records (created_at DESC);
CREATE INDEX IF NOT EXISTS tcrms_records_status_idx ON tcrms_records (record_status);
CREATE INDEX IF NOT EXISTS tcrms_records_name_idx ON tcrms_records (LOWER(full_name));

CREATE TABLE IF NOT EXISTS tcrms_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES tcrms_users(id),
  actor_username VARCHAR(150) NOT NULL,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(100),
  request_id VARCHAR(100),
  ip_hash VARCHAR(128),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tcrms_audit_created_at_idx ON tcrms_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS tcrms_audit_actor_idx ON tcrms_audit_logs (actor_user_id, created_at DESC);

COMMIT;
