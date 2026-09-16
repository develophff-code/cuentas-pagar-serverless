BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE plan_code AS ENUM ('BASIC', 'PROFESSIONAL', 'ULTRA');
CREATE TYPE tenant_access_status AS ENUM ('TRIAL', 'ACTIVE', 'BLOCKED_PAYMENT', 'ACCESS_EXPIRED');
CREATE TYPE membership_role AS ENUM ('ADMIN', 'OPERATOR_UPLOAD', 'OPERATOR_PAYMENTS');
CREATE TYPE invoice_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'IN_GRID', 'PAYMENT_PROPOSED', 'PAID', 'CANCELED');
CREATE TYPE payment_batch_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'RECORDED', 'REVERSED');
CREATE TYPE subscription_order_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');
CREATE TYPE subscription_status AS ENUM ('TRIAL', 'ACTIVE', 'BLOCKED_PAYMENT', 'EXPIRED');
CREATE TYPE document_source AS ENUM ('WHATSAPP', 'WEB');
CREATE TYPE document_status AS ENUM ('UPLOADING', 'UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'REJECTED', 'FAILED');
CREATE TYPE outbound_message_status AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

CREATE TABLE plans (
  code plan_code PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_capability_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code plan_code NOT NULL REFERENCES plans(code),
  max_invoices_per_month integer NOT NULL CHECK (max_invoices_per_month > 0),
  max_suppliers integer NOT NULL CHECK (max_suppliers > 0),
  max_active_users integer NOT NULL CHECK (max_active_users > 0),
  max_storage_bytes bigint NOT NULL DEFAULT 0 CHECK (max_storage_bytes >= 0),
  monthly_ai_queries integer NOT NULL DEFAULT 0 CHECK (monthly_ai_queries >= 0),
  dashboard_enabled boolean NOT NULL DEFAULT false,
  supplier_notifications_enabled boolean NOT NULL DEFAULT false,
  web_operations_enabled boolean NOT NULL DEFAULT false,
  web_administration_enabled boolean NOT NULL DEFAULT false,
  ai_chat_enabled boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX plan_capability_versions_one_active_per_plan
  ON plan_capability_versions(plan_code)
  WHERE valid_to IS NULL;

CREATE TABLE plan_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code plan_code NOT NULL REFERENCES plans(code),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX plan_price_versions_one_active_per_plan
  ON plan_price_versions(plan_code)
  WHERE valid_to IS NULL;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  cuit varchar(13),
  access_status tenant_access_status NOT NULL DEFAULT 'TRIAL',
  trial_started_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL,
  blocked_until timestamptz,
  access_expires_at timestamptz,
  current_plan_code plan_code REFERENCES plans(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_ends_at > trial_started_at),
  CHECK (blocked_until IS NULL OR blocked_until >= trial_ends_at),
  CHECK (access_expires_at IS NULL OR access_expires_at >= trial_ends_at)
);

CREATE INDEX tenants_access_status_idx ON tenants(access_status);

CREATE TABLE application_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub text UNIQUE,
  email text NOT NULL,
  full_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX application_users_email_ci_key ON application_users(lower(email));

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES application_users(id),
  role membership_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES application_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX tenant_memberships_user_idx ON tenant_memberships(user_id, is_active);

CREATE TABLE whatsapp_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES application_users(id),
  provider text NOT NULL DEFAULT 'YCLOUD',
  bsuid text,
  phone_number varchar(32),
  verified_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bsuid IS NOT NULL OR phone_number IS NOT NULL)
);

CREATE UNIQUE INDEX whatsapp_identities_provider_bsuid_key
  ON whatsapp_identities(provider, bsuid)
  WHERE bsuid IS NOT NULL;
CREATE UNIQUE INDEX whatsapp_identities_provider_phone_key
  ON whatsapp_identities(provider, phone_number)
  WHERE phone_number IS NOT NULL;

CREATE TABLE categories (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  sort_order smallint NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  business_name text NOT NULL CHECK (length(trim(business_name)) > 0),
  mobile_phone varchar(32) NOT NULL CHECK (length(trim(mobile_phone)) > 0),
  cuit varchar(13),
  address text,
  category_code text REFERENCES categories(code),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES application_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE suppliers ADD CONSTRAINT suppliers_id_tenant_key UNIQUE (id, tenant_id);
CREATE INDEX suppliers_tenant_category_idx ON suppliers(tenant_id, category_code);
CREATE INDEX suppliers_tenant_cuit_idx ON suppliers(tenant_id, cuit) WHERE cuit IS NOT NULL;

CREATE TABLE supplier_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  encrypted_account_value bytea NOT NULL,
  account_value_last4 varchar(4),
  account_type text NOT NULL DEFAULT 'CBU_CVU_ALIAS',
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX supplier_bank_accounts_one_primary_per_supplier
  ON supplier_bank_accounts(supplier_id)
  WHERE is_primary;

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source document_source NOT NULL,
  status document_status NOT NULL DEFAULT 'UPLOADING',
  object_key text UNIQUE,
  original_file_name text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256 char(64),
  source_message_id text,
  created_by_user_id uuid REFERENCES application_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_tenant_status_idx ON documents(tenant_id, status);
CREATE INDEX documents_tenant_hash_idx ON documents(tenant_id, sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE invoice_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid UNIQUE REFERENCES documents(id),
  status invoice_status NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'CANCELED')),
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_notes text,
  created_by_user_id uuid REFERENCES application_users(id),
  reviewed_by_user_id uuid REFERENCES application_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL,
  source_draft_id uuid UNIQUE REFERENCES invoice_drafts(id),
  document_id uuid REFERENCES documents(id),
  invoice_type text NOT NULL DEFAULT 'INFORMAL',
  invoice_number text,
  description text,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  issue_date date,
  due_date date NOT NULL,
  scheduled_payment_date date,
  status invoice_status NOT NULL DEFAULT 'PENDING_REVIEW',
  raw_extraction_data jsonb,
  created_by_user_id uuid REFERENCES application_users(id),
  confirmed_by_user_id uuid REFERENCES application_users(id),
  canceled_by_user_id uuid REFERENCES application_users(id),
  canceled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (invoice_type IN ('A', 'C') AND invoice_number IS NOT NULL)
    OR (invoice_type = 'INFORMAL' AND description IS NOT NULL)
  ),
  CHECK (status <> 'CANCELED' OR canceled_at IS NOT NULL)
);

ALTER TABLE invoices ADD CONSTRAINT invoices_supplier_same_tenant_fkey
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers(id, tenant_id);
ALTER TABLE invoices ADD CONSTRAINT invoices_id_tenant_key UNIQUE (id, tenant_id);
CREATE INDEX invoices_tenant_status_due_idx ON invoices(tenant_id, status, due_date);
CREATE INDEX invoices_tenant_scheduled_payment_idx ON invoices(tenant_id, scheduled_payment_date);
CREATE INDEX invoices_supplier_idx ON invoices(supplier_id);
CREATE UNIQUE INDEX invoices_fiscal_reference_key
  ON invoices(tenant_id, supplier_id, invoice_type, invoice_number)
  WHERE invoice_type IN ('A', 'C') AND status <> 'CANCELED';

CREATE TABLE payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  status payment_batch_status NOT NULL DEFAULT 'DRAFT',
  idempotency_key text NOT NULL,
  proposed_by_user_id uuid NOT NULL REFERENCES application_users(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by_user_id uuid REFERENCES application_users(id),
  confirmed_at timestamptz,
  reversed_by_user_id uuid REFERENCES application_users(id),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK ((status <> 'RECORDED') OR (confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK ((status <> 'REVERSED') OR (reversed_by_user_id IS NOT NULL AND reversed_at IS NOT NULL))
);

ALTER TABLE payment_batches ADD CONSTRAINT payment_batches_id_tenant_key UNIQUE (id, tenant_id);
CREATE INDEX payment_batches_tenant_status_idx ON payment_batches(tenant_id, status);

CREATE TABLE payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_batch_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_batch_id, invoice_id),
  FOREIGN KEY (payment_batch_id, tenant_id) REFERENCES payment_batches(id, tenant_id),
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES invoices(id, tenant_id)
);

CREATE INDEX payment_items_invoice_idx ON payment_items(invoice_id);

CREATE TABLE payment_grid_configs (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  notification_time time NOT NULL DEFAULT '08:00',
  look_ahead_hours smallint NOT NULL DEFAULT 24 CHECK (look_ahead_hours BETWEEN 1 AND 168),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_grid_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid NOT NULL REFERENCES tenant_memberships(id),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, membership_id)
);

CREATE TABLE inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_sha256 char(64),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'PENDING',
  payload jsonb NOT NULL,
  UNIQUE (provider, external_event_id)
);

CREATE INDEX inbound_events_status_idx ON inbound_events(processing_status, received_at);

CREATE TABLE notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recipient_membership_id uuid REFERENCES tenant_memberships(id),
  intent_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  notification_intent_id uuid REFERENCES notification_intents(id),
  recipient_identity_id uuid REFERENCES whatsapp_identities(id),
  logical_key text NOT NULL,
  status outbound_message_status NOT NULL DEFAULT 'PENDING',
  provider text NOT NULL DEFAULT 'YCLOUD',
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, logical_key)
);

CREATE UNIQUE INDEX outbound_messages_provider_message_key
  ON outbound_messages(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE subscription_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_code plan_code NOT NULL REFERENCES plans(code),
  price_version_id uuid NOT NULL REFERENCES plan_price_versions(id),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  status subscription_order_status NOT NULL DEFAULT 'PENDING',
  checkout_provider text NOT NULL DEFAULT 'MERCADO_PAGO',
  external_reference text NOT NULL UNIQUE,
  checkout_preference_id text UNIQUE,
  checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_by_user_id uuid REFERENCES application_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_orders_tenant_status_idx ON subscription_orders(tenant_id, status);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_code plan_code NOT NULL REFERENCES plans(code),
  status subscription_status NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source_order_id uuid REFERENCES subscription_orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX subscriptions_tenant_dates_idx ON subscriptions(tenant_id, starts_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_user_id uuid REFERENCES application_users(id),
  actor_whatsapp_identity_id uuid REFERENCES whatsapp_identities(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  source text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_tenant_created_idx ON audit_events(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_payment_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_amount numeric(14, 2);
  invoice_current_status invoice_status;
BEGIN
  SELECT amount, status
    INTO invoice_amount, invoice_current_status
    FROM invoices
   WHERE id = NEW.invoice_id
     AND tenant_id = NEW.tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La factura no pertenece al tenant del pago';
  END IF;

  IF invoice_current_status NOT IN ('IN_GRID', 'PAYMENT_PROPOSED') THEN
    RAISE EXCEPTION 'La factura % no está disponible para pago', NEW.invoice_id;
  END IF;

  IF NEW.amount <> invoice_amount THEN
    RAISE EXCEPTION 'No se admiten pagos parciales ni importes distintos al total de la factura';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER application_users_set_updated_at BEFORE UPDATE ON application_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tenant_memberships_set_updated_at BEFORE UPDATE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER whatsapp_identities_set_updated_at BEFORE UPDATE ON whatsapp_identities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER supplier_bank_accounts_set_updated_at BEFORE UPDATE ON supplier_bank_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoice_drafts_set_updated_at BEFORE UPDATE ON invoice_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_batches_set_updated_at BEFORE UPDATE ON payment_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_items_validate_before_insert BEFORE INSERT ON payment_items FOR EACH ROW EXECUTE FUNCTION validate_payment_item();
CREATE TRIGGER payment_grid_configs_set_updated_at BEFORE UPDATE ON payment_grid_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER outbound_messages_set_updated_at BEFORE UPDATE ON outbound_messages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscription_orders_set_updated_at BEFORE UPDATE ON subscription_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO plans (code, name) VALUES
  ('BASIC', 'Básico'),
  ('PROFESSIONAL', 'Profesional'),
  ('ULTRA', 'Ultra');

INSERT INTO plan_capability_versions (
  plan_code, max_invoices_per_month, max_suppliers, max_active_users,
  dashboard_enabled, supplier_notifications_enabled, web_operations_enabled,
  web_administration_enabled, ai_chat_enabled, valid_from
) VALUES
  ('BASIC', 100, 25, 1, false, false, false, false, false, '2026-09-16T00:00:00Z'),
  ('PROFESSIONAL', 300, 80, 3, true, true, true, true, false, '2026-09-16T00:00:00Z'),
  ('ULTRA', 500, 150, 5, true, true, true, true, true, '2026-09-16T00:00:00Z');

INSERT INTO plan_price_versions (plan_code, amount, currency, valid_from) VALUES
  ('BASIC', 28000.00, 'ARS', '2026-09-16T00:00:00Z'),
  ('PROFESSIONAL', 82000.00, 'ARS', '2026-09-16T00:00:00Z'),
  ('ULTRA', 144000.00, 'ARS', '2026-09-16T00:00:00Z');

INSERT INTO categories (code, name, sort_order) VALUES
  ('RENT_EXPENSES', 'Alquileres y Expensas', 1),
  ('GENERAL_EXPENSES', 'Gastos Generales', 2),
  ('PROFESSIONAL_FEES', 'Honorarios Profesionales', 3),
  ('TAXES_FEES', 'Impuestos y Tasas', 4),
  ('OFFICE_SUPPLIES', 'Librería e Insumos de Oficina', 5),
  ('LOGISTICS_FREIGHT', 'Logística y Fletes', 6),
  ('MAINTENANCE_CLEANING', 'Mantenimiento y Limpieza', 7),
  ('GOODS_RAW_MATERIALS', 'Mercadería y Materias Primas', 8),
  ('MARKETING', 'Publicidad y Marketing', 9),
  ('UTILITIES', 'Servicios Públicos (Luz, Gas, Agua, Internet)', 10);

COMMIT;
