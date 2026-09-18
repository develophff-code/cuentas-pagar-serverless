BEGIN;

ALTER TABLE suppliers
  ADD COLUMN idempotency_key text,
  ADD COLUMN idempotency_fingerprint char(64);

ALTER TABLE invoices
  ADD COLUMN idempotency_key text,
  ADD COLUMN idempotency_fingerprint char(64);

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_idempotency_pair_check
  CHECK (
    (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
    OR (length(trim(idempotency_key)) > 0 AND idempotency_fingerprint IS NOT NULL)
  );

ALTER TABLE invoices
  ADD CONSTRAINT invoices_idempotency_pair_check
  CHECK (
    (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
    OR (length(trim(idempotency_key)) > 0 AND idempotency_fingerprint IS NOT NULL)
  );

CREATE UNIQUE INDEX suppliers_tenant_idempotency_key
  ON suppliers(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX invoices_tenant_idempotency_key
  ON invoices(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
