-- Tenant-owned data. Three independent layers keep tenants apart:
--   1. the application always scopes by the tenant taken from the verified token;
--   2. composite foreign keys (id, tenant_id) make cross-tenant references unrepresentable;
--   3. row-level security makes the *database* refuse rows of any other tenant, even if (1) has a bug.

CREATE TABLE resources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  data       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'),
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version    integer     NOT NULL DEFAULT 1,           -- optimistic concurrency
  created_by uuid        NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
-- Keyset pagination (created_at DESC, id DESC) scoped by tenant. The partial variant is what the
-- default listing uses: archived rows never bloat the hot index.
CREATE INDEX resources_tenant_keyset_idx ON resources (tenant_id, created_at DESC, id DESC);
CREATE INDEX resources_tenant_active_keyset_idx ON resources (tenant_id, created_at DESC, id DESC)
  WHERE status = 'active';
CREATE INDEX resources_created_by_idx ON resources (created_by);

-- Per-tenant endpoints that receive our outbound events.
CREATE TABLE webhook_endpoints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  url        text        NOT NULL CHECK (url ~ '^https?://'),
  secret     text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX webhook_endpoints_tenant_active_idx ON webhook_endpoints (tenant_id) WHERE active;

-- Replays of a client request (same Idempotency-Key) return the stored response instead of repeating
-- the side effect. Scope = tenant + actor + action + key; the payload hash detects key reuse.
CREATE TABLE idempotency_keys (
  tenant_id       uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_id        uuid        NOT NULL,
  action          text        NOT NULL,
  key             text        NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  request_hash    text        NOT NULL,
  response_status integer     NOT NULL,
  response_body   jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, actor_id, action, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- Row-level security. `current_setting(..., true)` is NULL when the context was never set and
-- NULLIF turns the empty string left behind after a transaction into NULL as well: either way the
-- comparison is not true and the policy yields ZERO rows -- fail closed.
CREATE FUNCTION current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['resources', 'webhook_endpoints', 'idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())',
      t
    );
  END LOOP;
END $$;
