CREATE TABLE IF NOT EXISTS entries_latest (
  id TEXT PRIMARY KEY,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entries_latest_updated_at_desc ON entries_latest (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS entries_latest_type ON entries_latest (type);
CREATE INDEX IF NOT EXISTS entries_latest_namespace ON entries_latest (namespace);
CREATE INDEX IF NOT EXISTS entries_latest_attrs_path_ops_gin ON entries_latest USING GIN (attrs jsonb_path_ops);
CREATE INDEX IF NOT EXISTS entries_latest_attrs_ops_gin ON entries_latest USING GIN (attrs);

INSERT INTO entries_latest (
  id,
  rev,
  type,
  namespace,
  name,
  description,
  version,
  attrs,
  manifest,
  meta,
  created_at,
  updated_at
)
SELECT DISTINCT ON (id)
  id,
  rev,
  type,
  namespace,
  name,
  description,
  version,
  CASE
    WHEN jsonb_typeof(attrs) = 'string' AND LEFT(COALESCE(attrs #>> '{}', ''), 1) IN ('{', '[')
      THEN (attrs #>> '{}')::jsonb
    ELSE attrs
  END AS attrs,
  CASE
    WHEN manifest IS NULL THEN NULL
    WHEN jsonb_typeof(manifest) = 'string' AND LEFT(COALESCE(manifest #>> '{}', ''), 1) IN ('{', '[')
      THEN (manifest #>> '{}')::jsonb
    ELSE manifest
  END AS manifest,
  CASE
    WHEN meta IS NULL THEN NULL
    WHEN jsonb_typeof(meta) = 'string' AND LEFT(COALESCE(meta #>> '{}', ''), 1) IN ('{', '[')
      THEN (meta #>> '{}')::jsonb
    ELSE meta
  END AS meta,
  created_at,
  updated_at
FROM entries
ORDER BY id, rev DESC
ON CONFLICT (id) DO UPDATE
SET
  rev = EXCLUDED.rev,
  type = EXCLUDED.type,
  namespace = EXCLUDED.namespace,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  version = EXCLUDED.version,
  attrs = EXCLUDED.attrs,
  manifest = EXCLUDED.manifest,
  meta = EXCLUDED.meta,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at
WHERE entries_latest.rev <= EXCLUDED.rev;
