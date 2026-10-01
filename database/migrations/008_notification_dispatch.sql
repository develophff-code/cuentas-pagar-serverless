-- Reserva durable antes de llamar a YCloud. Un resultado ambiguo exige revisión,
-- porque externalId permite conciliar pero no garantiza deduplicación del proveedor.
BEGIN;
ALTER TABLE outbound_messages
  ADD COLUMN dispatch_state text NOT NULL DEFAULT 'READY'
    CHECK (dispatch_state IN ('READY', 'PROCESSING', 'RETRY', 'COMPLETE', 'BLOCKED', 'UNKNOWN')),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimed_at timestamptz;
UPDATE outbound_messages SET dispatch_state = CASE
  WHEN status IN ('SENT', 'DELIVERED', 'READ') THEN 'COMPLETE'
  WHEN status = 'FAILED' THEN 'BLOCKED'
  WHEN attempt_count > 0 THEN 'UNKNOWN'
  ELSE 'READY' END;
CREATE INDEX outbound_messages_dispatch_due_idx ON outbound_messages(next_attempt_at, created_at)
  WHERE dispatch_state IN ('READY', 'RETRY');
CREATE INDEX notification_intents_scheduled_idx ON notification_intents(scheduled_for, created_at);
COMMIT;
