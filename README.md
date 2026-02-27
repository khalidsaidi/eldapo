# eldapo

LDAP-inspired capability directory API for agents (MCP/RAG/skills), built with Next.js Route Handlers + Postgres.

## Features

- Immutable, revisioned entries (`id`, `rev`)
- Search with LDAP-like filter syntax compiled to parameterized SQL
- Visibility controls (`public` / `internal` / `restricted`)
- Endpoints for search, get, versions, batch get, publish, and status updates
- Incremental change feed for agent cache refresh
- `entries_latest` table for fast latest-entry reads
- Local Postgres via Docker Compose
- Unit tests with Vitest

## Tech Stack

- TypeScript + Node.js
- Next.js (App Router Route Handlers)
- Postgres + `postgres` (postgres-js)
- Zod validation
- Vitest

## Local Development

```bash
docker compose up -d
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Service runs at `http://localhost:3000`.

## API Endpoints

Canonical:
- `GET /v1/search`
- `GET /v1/entries/{id}`
- `GET /v1/entries/{id}/versions`
- `POST /v1/batchGet`
- `GET /v1/changes`
- `POST /v1/entries/publish`
- `POST /v1/entries/{id}/setStatus`

Rewrite-compatible:
- `POST /v1/entries:publish`
- `POST /v1/entries/{id}:setStatus`

## Example cURL

Search with URL-encoded filter:

```bash
curl "http://localhost:3000/v1/search?filter=%28%26%28type%3Dskill%29%28capability%3Dsummarize%29%29"
```

Search by type:

```bash
curl "http://localhost:3000/v1/search?filter=%28type%3Dskill%29"
```

Get latest entry:

```bash
curl "http://localhost:3000/v1/entries/skill:acme:pdf-summarize"
```

List versions:

```bash
curl "http://localhost:3000/v1/entries/skill:acme:pdf-summarize/versions"
```

Read changes since sequence `0`:

```bash
curl "http://localhost:3000/v1/changes?since=0&limit=50"
```

Batch get:

```bash
curl -X POST "http://localhost:3000/v1/batchGet" \
  -H "content-type: application/json" \
  -d '{"ids":["skill:acme:pdf-summarize","mcp:acme:finance-tools"],"view":"card"}'
```

Publish (writes must be enabled):

```bash
curl -X POST "http://localhost:3000/v1/entries:publish" \
  -H "content-type: application/json" \
  -H "x-eldapo-admin-key: change-me" \
  -d '{
    "id":"skill:acme:new-skill",
    "type":"skill",
    "namespace":"acme",
    "name":"New Skill",
    "description":"Example skill",
    "attrs":{"capability":["summarize"],"visibility":["public"],"status":["active"]}
  }'
```

Set status:

```bash
curl -X POST "http://localhost:3000/v1/entries/skill:acme:pdf-summarize:setStatus" \
  -H "content-type: application/json" \
  -H "x-eldapo-admin-key: change-me" \
  -d '{"status":"deprecated","reason":"Superseded by v2"}'
```

## Visibility Notes

- `attrs.visibility=["public"]`: visible to all.
- `attrs.visibility=["internal"]`: visible to authenticated requesters.
- `attrs.visibility=["restricted"]`: requester must be authenticated and share at least one `attrs.allowed_group`.
- Missing `visibility` defaults to public.

Trusted header requester parsing is enabled only when:
- `ELDAPPO_TRUSTED_HEADERS=true`

Then requester context is read from:
- `authorization`
- `x-eldapo-sub`
- `x-eldapo-groups` (comma-separated)

## Filter Grammar

Filter grammar is documented in [docs/filter.ebnf](docs/filter.ebnf). Key mapping rules are in [docs/spec.md](docs/spec.md).

## Performance Debugging

Inspect representative query plans locally:

```bash
pnpm db:explain
```

The helper runs `EXPLAIN (ANALYZE, BUFFERS)` for:
- `(type=skill)`
- `(&(type=skill)(capability=summarize))`
- `(&(type=rag)(capability=retrieve)(tag=finance))`

Notes:
- Attribute equality compiles to JSONB containment (`attrs @> ...`).
- Presence remains key-exists (`attrs ? key`) and uses the `entries_attrs_ops_gin` index.
- Search/get-latest/batchGet read from `entries_latest` to avoid per-request latest-revision recomputation.

## Deployment Notes (Vercel-friendly)

Set env vars:
- `DATABASE_URL`
- `ELDAPPO_TRUSTED_HEADERS` (only enable behind a trusted auth proxy)
- `ELDAPPO_ENABLE_WRITES=false` by default
- `ELDAPPO_ADMIN_KEY` (required if writes are enabled)

## Agent Caching Strategy

- Cache entries by `{id, rev}`.
- Poll `GET /v1/changes?since=<last_seq>&limit=...` to discover updates.
- `/v1/changes` is visibility-aware: events the requester cannot see are omitted.
- For each change event, fetch latest entry by id and refresh local cache pointers.
- Use `next_since` from the response for the next poll.
- `next_since` advances by scanned sequence (even when all scanned events are hidden), so clients do not get stuck.

## Scripts

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm test`
- `pnpm test:watch`
- `pnpm test:db` (optional, requires `ELDAPO_DB_TESTS=true` and running Postgres seed data)
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm db:explain`
