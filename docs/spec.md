# eldapo Spec (v0.1)

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

Visibility policy keys in `attrs`:
- `visibility`: `public` | `internal` | `restricted` (default: public)
- `allowed_group`: groups for restricted entries

## Endpoints

Canonical routes:
- `GET /v1/search`
- `GET /v1/entries/{id}`
- `GET /v1/entries/{id}/versions`
- `POST /v1/batchGet`
- `POST /v1/entries/publish`
- `POST /v1/entries/{id}/setStatus`

Compatibility rewrites also support:
- `POST /v1/entries:publish` -> `/v1/entries/publish`
- `POST /v1/entries/{id}:setStatus` -> `/v1/entries/{id}/setStatus`

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
