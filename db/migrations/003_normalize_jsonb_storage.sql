UPDATE entries
SET attrs = (attrs #>> '{}')::jsonb
WHERE jsonb_typeof(attrs) = 'string'
  AND LEFT(COALESCE(attrs #>> '{}', ''), 1) IN ('{', '[');

UPDATE entries
SET manifest = (manifest #>> '{}')::jsonb
WHERE manifest IS NOT NULL
  AND jsonb_typeof(manifest) = 'string'
  AND LEFT(COALESCE(manifest #>> '{}', ''), 1) IN ('{', '[');

UPDATE entries
SET meta = (meta #>> '{}')::jsonb
WHERE meta IS NOT NULL
  AND jsonb_typeof(meta) = 'string'
  AND LEFT(COALESCE(meta #>> '{}', ''), 1) IN ('{', '[');

UPDATE entries_latest
SET attrs = (attrs #>> '{}')::jsonb
WHERE jsonb_typeof(attrs) = 'string'
  AND LEFT(COALESCE(attrs #>> '{}', ''), 1) IN ('{', '[');

UPDATE entries_latest
SET manifest = (manifest #>> '{}')::jsonb
WHERE manifest IS NOT NULL
  AND jsonb_typeof(manifest) = 'string'
  AND LEFT(COALESCE(manifest #>> '{}', ''), 1) IN ('{', '[');

UPDATE entries_latest
SET meta = (meta #>> '{}')::jsonb
WHERE meta IS NOT NULL
  AND jsonb_typeof(meta) = 'string'
  AND LEFT(COALESCE(meta #>> '{}', ''), 1) IN ('{', '[');

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
  attrs,
  manifest,
  meta,
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
