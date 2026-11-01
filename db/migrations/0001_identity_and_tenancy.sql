-- Identity & tenancy.
--
-- Roles: migrations run as the schema OWNER; the application connects as `app_user`, a plain role
-- that is neither superuser nor table owner. That matters: superusers and owners bypass row-level
-- security, so an app connecting as the owner would silently make every RLS policy decorative.

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  plan       text        NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  -- Vertical ("niche") only selects the UI theme/vocabulary; the API itself is niche-agnostic.
  niche      text        NOT NULL DEFAULT 'general' CHECK (niche IN ('general', 'restaurant', 'legal', 'civic', 'wellness')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE memberships (
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
-- "which tenants does this user belong to?" (login) -- the PK only serves the opposite direction.
CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE active;

-- Refresh tokens are opaque, stored only as SHA-256, rotated on every use and grouped in a
-- "family" so reuse of an already-rotated token can revoke the whole chain (theft detection).
-- The composite FK makes it impossible to hold a token for a tenant the user does not belong to.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  family_id   uuid        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
-- Only for the periodic cleanup of expired rows.
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

-- Fixed-window counters for brute-force protection. Shared by every replica (unlike in-process maps).
CREATE TABLE rate_limits (
  key        text PRIMARY KEY,
  count      integer     NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits (expires_at);
