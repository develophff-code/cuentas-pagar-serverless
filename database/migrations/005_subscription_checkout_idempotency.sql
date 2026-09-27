BEGIN;

ALTER TABLE subscription_orders
  ADD COLUMN idempotency_key text,
  ADD COLUMN idempotency_fingerprint char(64);

CREATE UNIQUE INDEX subscription_orders_tenant_idempotency_key
  ON subscription_orders(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX subscriptions_source_order_id_key
  ON subscriptions(source_order_id)
  WHERE source_order_id IS NOT NULL;

COMMIT;
