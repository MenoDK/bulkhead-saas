-- Hash-chained, append-only audit log + transactional outbox.

CREATE TABLE audit_logs (
  seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id          uuid        NOT NULL UNIQUE,
  -- No ON DELETE CASCADE on purpose: a tenant with audit history cannot simply be deleted. Offboarding
  -- is a deliberate procedure that honours retention, not a side effect of one DELETE.
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  actor_id    uuid,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   text,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  prev_hash   text,
  hash        text        NOT NULL,
  created_at  timestamptz NOT NULL,
  -- Two entries can never claim the same predecessor: a forked chain is rejected by the database.
  -- NULLS NOT DISTINCT makes the genesis entry (prev_hash IS NULL) unique per tenant too.
  CONSTRAINT audit_chain_no_fork UNIQUE NULLS NOT DISTINCT (tenant_id, prev_hash)
);
-- Chain head lookup ("what is the last hash for this tenant?") and ordered verification scans.
CREATE INDEX audit_logs_tenant_seq_idx ON audit_logs (tenant_id, seq DESC);
-- Time-range exports on an append-only, naturally time-ordered table: BRIN is ~1000x smaller than a
-- b-tree here. (At very large volumes, range-partition by created_at; the per-tenant chain is
-- partition-friendly -- see docs/adr/0003.)
CREATE INDEX audit_logs_created_brin_idx ON audit_logs USING brin (created_at);

-- Append-only, enforced twice: privileges (app_user cannot UPDATE/DELETE) and a trigger (nobody can,
-- including the owner, unless they consciously disable the trigger -- which is itself auditable).
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- Transactional outbox: the event row is written in the SAME transaction as the business change, so
-- "state changed" and "event will be delivered" cannot diverge. A worker delivers it afterwards,
-- at-least-once; receivers de-duplicate on the event id.
-- System table: read only by the worker, never through tenant-scoped queries (hence no RLS).
CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  endpoint_id     uuid        NOT NULL,
  topic           text        NOT NULL,
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  FOREIGN KEY (endpoint_id, tenant_id) REFERENCES webhook_endpoints (id, tenant_id) ON DELETE CASCADE
);
-- The worker's hot query touches only rows that are still pending: delivered/dead rows are not indexed.
CREATE INDEX outbox_due_idx ON outbox_events (next_attempt_at) WHERE status = 'pending';
