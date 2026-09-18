BEGIN;

ALTER TABLE payment_batches
  ADD COLUMN idempotency_fingerprint char(64);

COMMIT;
