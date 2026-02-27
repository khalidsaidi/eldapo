# eldapo Spec (v0.3 + core accelerator)

`eldapo` is an LDAP-inspired capability directory for agents. Entries are immutable by revision (`id`, `rev`) and queryable with a tiny filter language.

## Data Model

An entry has:
- `id` (text): logical identifier, e.g. `skill:acme:pdf-summarize`
- `rev` (int): immutable revision number
- `type` (text): e.g. `mcp`, `rag`, `skill`
- `namespace` (text)
- `name` (text)
- `description` (text)
- `version` (nullable text)
- `attrs` (jsonb): string-array attributes (e.g. `tag`, `capability`, `visibility`, `allowed_group`)
- `manifest` (jsonb, nullable)
- `meta` (jsonb, nullable)
- `created_at`, `updated_at` (timestamptz)

Storage tables:
- `entries`: immutable revision history (`id`, `rev`)
- `entries_latest`: one latest row per `id` for fast current lookups
- `changes`: ordered change log (`seq`, `id`, `rev`, `change_type`, `changed_at`)

Visibility policy keys in `attrs`:
- `visibility`: `public` | `internal` | `restricted` (default: public)
- `allowed_group`: groups for restricted entries

## Endpoints

Canonical routes:
- `GET /v1/search`
- `GET /v1/entries/{id}`
- `GET /v1/entries/{id}/versions`
- `POST /v1/batchGet`
- `GET /v1/changes`
- `POST /v1/entries/publish`
- `POST /v1/entries/{id}/setStatus`

Compatibility rewrites also support:
- `POST /v1/entries:publish` -> `/v1/entries/publish`
- `POST /v1/entries/{id}:setStatus` -> `/v1/entries/{id}/setStatus`

Optional core daemon routes (additive, internal acceleration):
- `GET /core/health`
- `GET /core/stats`
- `GET /core/search`
- `GET /core/entries/{id}`
- `POST /core/batchGet`
- `GET /core/changes`

Default views:
- `search`: `card` unless `view=full`
- `get`: `full` unless `view=card`

## Filter Rules

- `filter` is LDAP-like and must be URL-encoded when used in query strings.
- Key resolution:
  - `attrs.<key>` maps to JSON attributes directly.
  - Top-level keys: `id`, `type`, `name`, `namespace`, `version`, `rev`.
  - Any other key is treated as `attrs.<key>` shorthand.
- Attribute equality (`(capability=summarize)`) compiles to JSON containment:
  - `attrs @> '{"capability":["summarize"]}'::jsonb`
- Presence keeps LDAP-like key-exists semantics:
  - `(endpoint=*)` => `attrs ? 'endpoint'`
  - Supported by GIN `jsonb_ops` index on `attrs` (`entries_attrs_ops_gin`).

Example:
- `(&(type=skill)(capability=summarize))`

Grammar reference:
- See [filter.ebnf](./filter.ebnf)

## Read Paths

- `GET /v1/search` reads from `entries_latest`.
- `GET /v1/entries/{id}`:
  - latest (no `rev`): `entries_latest`
  - specific `rev`: `entries`
- `POST /v1/batchGet` reads from `entries_latest`.
- `GET /v1/entries/{id}/versions` reads from `entries`.

Core-forwarded read mode:
- When `ELDAPPO_USE_CORE=true`, `/v1/search`, latest `/v1/entries/{id}`, and `/v1/batchGet` are forwarded to `eldapo-core` if reachable.
- If core is unreachable, routes fall back to SQL path.
- Core keeps an in-memory inverted index built from `entries_latest` and refreshed by polling `changes`.

## Change Feed

- `GET /v1/changes?since=<seq>&limit=<n>`
- Returns:
  - `events`: ordered by ascending `seq`, visibility-filtered for requester context
  - `next_since`: highest scanned sequence (not just highest returned event)

Event shape:
- `seq` (bigint sequence)
- `id`
- `rev`
- `change_type` (`publish` | `set_status`)
- `changed_at`

Agent cache pattern:
- Maintain a local cursor (`since`).
- Poll `/v1/changes` and update cache keys by `{id, rev}`.
- Advance cursor to `next_since`.
- Hidden events still advance `next_since`, preventing infinite re-poll loops on unseen changes.
