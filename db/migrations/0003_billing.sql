-- Billing. Money is stored as integer minor units (bigint), never as float/numeric-with-rounding.
-- The invariants are enforced by the database as well as by the service: a bug in application code
-- cannot over-collect, over-refund or leave the books inconsistent.

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  currency       char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status         text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void')),
  total_cents    bigint      NOT NULL CHECK (total_cents >= 0),
  paid_cents     bigint      NOT NULL DEFAULT 0,
  refunded_cents bigint      NOT NULL DEFAULT 0,
  version        integer     NOT NULL DEFAULT 1,
  created_by     uuid        NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  CONSTRAINT invoices_paid_within_total CHECK (paid_cents >= 0 AND paid_cents <= total_cents),
  CONSTRAINT invoices_refunded_within_paid CHECK (refunded_cents >= 0 AND refunded_cents <= paid_cents)
);
CREATE INDEX invoices_tenant_keyset_idx ON invoices (tenant_id, created_at DESC, id DESC);

CREATE TABLE invoice_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid    NOT NULL,
  invoice_id  uuid    NOT NULL,
  position    integer NOT NULL CHECK (position >= 0),
  description text    NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_cents  bigint  NOT NULL CHECK (unit_cents >= 0),
  -- (invoice_id, tenant_id) -> a line can only belong to an invoice of its own tenant.
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES invoices (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (invoice_id, position)
);

-- Append-only ledger of money movements.
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  invoice_id   uuid        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount_cents bigint      NOT NULL CHECK (amount_cents > 0),
  provider     text,
  provider_ref text,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES invoices (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX payments_invoice_idx ON payments (tenant_id, invoice_id, created_at);
-- The same provider reference can never be booked twice, whatever the application does.
CREATE UNIQUE INDEX payments_provider_ref_uidx ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- Inbound-webhook inbox. Recording the event id and applying its effect happen in ONE transaction:
-- either both stick or neither does, so a redelivery after a crash is processed exactly once in effect.
-- System table (no tenant context needed to decide "have I seen this?"), never exposed through the API.
CREATE TABLE webhook_events (
  provider    text        NOT NULL,
  event_id    text        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX webhook_events_received_idx ON webhook_events USING brin (received_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'invoice_lines', 'payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())',
      t
    );
  END LOOP;
END $$;
