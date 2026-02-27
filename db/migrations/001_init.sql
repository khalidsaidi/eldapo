CREATE TABLE IF NOT EXISTS entries (
  id TEXT NOT NULL,
  rev INT NOT NULL,
  type TEXT NOT NULL,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest JSONB,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, rev)
);

CREATE INDEX IF NOT EXISTS entries_id_rev_desc ON entries (id, rev DESC);
CREATE INDEX IF NOT EXISTS entries_type ON entries (type);
CREATE INDEX IF NOT EXISTS entries_namespace ON entries (namespace);
CREATE INDEX IF NOT EXISTS entries_updated_at_desc ON entries (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS entries_attrs_gin ON entries USING GIN (attrs jsonb_path_ops);
CREATE INDEX IF NOT EXISTS entries_attrs_capability_gin ON entries USING GIN ((attrs->'capability'));
CREATE INDEX IF NOT EXISTS entries_attrs_tag_gin ON entries USING GIN ((attrs->'tag'));
