BEGIN;

ALTER TYPE outbound_message_status ADD VALUE IF NOT EXISTS 'SENDING';

CREATE TABLE subscription_payment_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_order_id uuid NOT NULL REFERENCES subscription_orders(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX subscription_payment_link_tokens_active_idx
  ON subscription_payment_link_tokens(subscription_order_id, expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
