BEGIN;

CREATE TABLE late_fee_rate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_rate numeric(9, 6) NOT NULL CHECK (monthly_rate >= 0 AND monthly_rate <= 1),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX late_fee_rate_versions_one_active
  ON late_fee_rate_versions((1))
  WHERE valid_to IS NULL;

INSERT INTO late_fee_rate_versions (monthly_rate, valid_from)
VALUES (0.027500, '2026-09-27T00:00:00Z');

ALTER TABLE tenants ADD COLUMN data_purge_at timestamptz;
CREATE INDEX tenants_data_purge_at_idx ON tenants(data_purge_at) WHERE data_purge_at IS NOT NULL;

COMMIT;
