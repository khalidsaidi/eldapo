CREATE TABLE IF NOT EXISTS changes (
  seq BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL,
  rev INT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_type TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS changes_changed_at_desc ON changes (changed_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS changes_id_seq_desc ON changes (id, seq DESC);
