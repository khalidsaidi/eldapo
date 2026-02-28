import 'dotenv/config';

import { createServer, type IncomingMessage } from 'node:http';

import { roaringLibraryInitialize } from 'roaring-wasm';
import { z } from 'zod';

import { canSee, parseRequester } from '@/lib/access';
import { getDb } from '@/lib/db';
import { decodeCursor, normalizeAttrs, normalizeEntryRow } from '@/lib/entries';
import { AppError } from '@/lib/errors';
import { toFull } from '@/lib/view';

import { InMemoryCoreIndex } from '@/core/index';
import { FilterAstCache } from '@/daemon/filterCache';

type EntryRow = {
  id: string;
  rev: number;
  type: string;
  namespace: string;
  name: string;
  description: string;
  version: string | null;
  attrs: unknown;
  manifest: unknown;
  meta: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type ChangeJoinRow = {
  seq: number | string;
  id: string;
  rev: number | string;
  change_type: string;
  changed_at: Date | string;
  entry_id: string | null;
  entry_rev: number | string | null;
  entry_type: string | null;
  entry_namespace: string | null;
  entry_name: string | null;
  entry_description: string | null;
  entry_version: string | null;
  entry_attrs: unknown;
  entry_manifest: unknown;
  entry_meta: unknown;
  entry_created_at: Date | string | null;
  entry_updated_at: Date | string | null;
};

type ChangeVisibilityRow = {
  seq: number | string;
  id: string;
  rev: number | string;
  change_type: string;
  changed_at: Date | string;
  attrs: unknown;
};

const searchQuerySchema = z.object({
  filter: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  cursor: z.string().optional(),
  sort: z.enum(['updated_at_desc', 'none']).default('updated_at_desc'),
  view: z.enum(['card', 'full', 'ids']).default('card'),
});

const entryQuerySchema = z.object({
  view: z.enum(['card', 'full']).default('full'),
});

const batchGetSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  view: z.enum(['card', 'full']).default('full'),
});

const changesQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const port = Number(process.env.ELDAPPO_CORE_PORT ?? 4100);
const host = process.env.ELDAPPO_CORE_HOST ?? '127.0.0.1';
const pollMs = Number(process.env.ELDAPPO_CORE_POLL_MS ?? 500);
const pollBatch = Number(process.env.ELDAPPO_CORE_POLL_BATCH ?? 500);

const core = new InMemoryCoreIndex();
const filterCache = new FilterAstCache(Number(process.env.ELDAPPO_FILTER_CACHE_SIZE ?? 256));
let lastSeq = 0;
let pollInFlight = false;

async function main(): Promise<void> {
  await roaringLibraryInitialize();
  await loadSnapshot();

  const timer = setInterval(() => {
    void pollChanges();
  }, pollMs);
  timer.unref();

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.listen(port, host, () => {
    console.log(`eldapo-core listening on http://${host}:${port}`);
  });
}

async function loadSnapshot(): Promise<void> {
  const rows = (await getDb().unsafe(
    `
      SELECT
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
      FROM entries_latest
    `,
    [],
  )) as EntryRow[];

  core.buildFromSnapshot(rows.map((row) => normalizeEntryRow(row)));

  const seqRows = (await getDb().unsafe(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM changes`, [])) as Array<{
    max_seq: number | string;
  }>;

  lastSeq = Number(seqRows[0]?.max_seq ?? 0);
}

async function pollChanges(): Promise<void> {
  if (pollInFlight) {
    return;
  }

  pollInFlight = true;

  try {
    while (true) {
      const rows = (await getDb().unsafe(
        `
          SELECT
            c.seq,
            c.id,
            c.rev,
            c.change_type,
            c.changed_at,
            e.id AS entry_id,
            e.rev AS entry_rev,
            e.type AS entry_type,
            e.namespace AS entry_namespace,
            e.name AS entry_name,
            e.description AS entry_description,
            e.version AS entry_version,
            e.attrs AS entry_attrs,
            e.manifest AS entry_manifest,
            e.meta AS entry_meta,
            e.created_at AS entry_created_at,
            e.updated_at AS entry_updated_at
          FROM changes c
          LEFT JOIN entries e ON e.id = c.id AND e.rev = c.rev
          WHERE c.seq > $1
          ORDER BY c.seq ASC
          LIMIT $2
        `,
        [lastSeq, pollBatch],
      )) as ChangeJoinRow[];

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const seq = Number(row.seq);
        lastSeq = seq;

        if (!row.entry_id || row.entry_rev === null || row.entry_created_at === null || row.entry_updated_at === null) {
          continue;
        }

        const entry = normalizeEntryRow({
          id: row.entry_id,
          rev: Number(row.entry_rev),
          type: row.entry_type ?? '',
          namespace: row.entry_namespace ?? '',
          name: row.entry_name ?? '',
          description: row.entry_description ?? '',
          version: row.entry_version,
          attrs: row.entry_attrs,
          manifest: row.entry_manifest,
          meta: row.entry_meta,
          created_at: row.entry_created_at,
          updated_at: row.entry_updated_at,
        });

        core.applyChange(
          {
            id: row.id,
            rev: Number(row.rev),
          },
          entry,
        );
      }

      if (rows.length < pollBatch) {
        break;
      }
    }
  } catch (error) {
    console.error('core poll loop failed', error);
  } finally {
    pollInFlight = false;
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: import('node:http').ServerResponse<import('node:http').IncomingMessage>,
): Promise<void> {
  const origin = `http://${req.headers.host ?? `${host}:${port}`}`;
  const url = new URL(req.url ?? '/', origin);

  try {
    if (req.method === 'GET' && url.pathname === '/core/health') {
      sendJson(res, 200, {
        ok: true,
        docs: core.stats().docs,
        last_seq: lastSeq,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/core/stats') {
      sendJson(res, 200, {
        ...core.stats(),
        last_seq: lastSeq,
        poll_ms: pollMs,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/core/search') {
      const parsedQuery = searchQuerySchema.parse({
        filter: emptyToUndefined(url.searchParams.get('filter')),
        q: emptyToUndefined(url.searchParams.get('q')),
        limit: url.searchParams.get('limit') ?? undefined,
        cursor: emptyToUndefined(url.searchParams.get('cursor')),
        sort: emptyToUndefined(url.searchParams.get('sort')),
        view: emptyToUndefined(url.searchParams.get('view')),
      });

      const ast = parsedQuery.filter ? filterCache.getOrParse(parsedQuery.filter) : null;
      let cursor = null;
      if (parsedQuery.cursor) {
        if (parsedQuery.sort !== 'updated_at_desc') {
          throw new AppError('invalid_request', 'Cursor requires sort=updated_at_desc.');
        }

        try {
          cursor = decodeCursor(parsedQuery.cursor);
        } catch {
          throw new AppError('invalid_request', 'Invalid cursor.');
        }
      }

      const requester = parseRequester(toWebRequest(req, url));
      const searchResult = core.search(
        ast,
        {
          limit: parsedQuery.limit,
          cursor,
          q: parsedQuery.q,
          sort: parsedQuery.sort,
        },
        requester,
      );

      if (parsedQuery.view === 'ids') {
        sendJson(res, 200, {
          ids: searchResult.items.map((item) => item.entry.id),
          next_cursor: searchResult.next_cursor,
        });
        return;
      }

      sendJson(res, 200, {
        items: searchResult.items.map((item) =>
          parsedQuery.view === 'full' ? toFull(item.entry) : item.card,
        ),
        next_cursor: searchResult.next_cursor,
      });
      return;
    }

    const entryMatch = req.method === 'GET' ? url.pathname.match(/^\/core\/entries\/([^/]+)$/) : null;
    if (entryMatch) {
      const id = decodeURIComponent(entryMatch[1]);
      if (!id) {
        throw new AppError('invalid_request', 'Entry id is required.');
      }

      const parsedQuery = entryQuerySchema.parse({
        view: emptyToUndefined(url.searchParams.get('view')),
      });

      const requester = parseRequester(toWebRequest(req, url));
      const hit = core.read(id, requester);

      if (!hit) {
        throw new AppError('not_found', 'Entry not found.');
      }

      sendJson(res, 200, {
        item: parsedQuery.view === 'card' ? hit.card : toFull(hit.entry),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/core/batchGet') {
      const body = await readBody(req);
      const parsedBody = batchGetSchema.parse(body ? JSON.parse(body) : {});
      const requester = parseRequester(toWebRequest(req, url));

      const result = core.batchGet(parsedBody.ids, requester);

      sendJson(res, 200, {
        items: result.items.map((item) =>
          parsedBody.view === 'card' ? item.card : toFull(item.entry),
        ),
        omitted: result.omitted,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/core/changes') {
      const query = changesQuerySchema.parse({
        since: emptyToUndefined(url.searchParams.get('since')),
        limit: emptyToUndefined(url.searchParams.get('limit')),
      });

      const requester = parseRequester(toWebRequest(req, url));
      const scanWindow = Math.min(Math.max(query.limit * 5, 200), 5000);
      const events: Array<{
        seq: number;
        id: string;
        rev: number;
        change_type: string;
        changed_at: string;
      }> = [];

      let scannedSince = query.since;

      while (events.length < query.limit) {
        const rows = (await getDb().unsafe(
          `
            SELECT c.seq, c.id, c.rev, c.change_type, c.changed_at, e.attrs
            FROM changes c
            JOIN entries e ON e.id = c.id AND e.rev = c.rev
            WHERE c.seq > $1
            ORDER BY c.seq ASC
            LIMIT $2
          `,
          [scannedSince, scanWindow],
        )) as ChangeVisibilityRow[];

        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const seq = Number(row.seq);
          scannedSince = seq;

          const attrs = normalizeAttrs(row.attrs);
          if (!canSee({ attrs }, requester)) {
            continue;
          }

          events.push({
            seq,
            id: row.id,
            rev: Number(row.rev),
            change_type: row.change_type,
            changed_at:
              row.changed_at instanceof Date
                ? row.changed_at.toISOString()
                : new Date(row.changed_at).toISOString(),
          });

          if (events.length >= query.limit) {
            break;
          }
        }

        if (rows.length < scanWindow) {
          break;
        }
      }

      sendJson(res, 200, {
        next_since: scannedSince,
        events,
      });
      return;
    }

    throw new AppError('not_found', 'Route not found.');
  } catch (error) {
    sendError(res, error);
  }
}

function toWebRequest(req: IncomingMessage, url: URL): Request {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  return new Request(url.toString(), {
    method: req.method,
    headers,
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(
  res: import('node:http').ServerResponse<import('node:http').IncomingMessage>,
  status: number,
  payload: unknown,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendError(
  res: import('node:http').ServerResponse<import('node:http').IncomingMessage>,
  error: unknown,
): void {
  if (error instanceof AppError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof z.ZodError) {
    sendJson(res, 400, {
      error: {
        code: 'invalid_request',
        message: 'Request validation failed.',
        details: error.flatten(),
      },
    });
    return;
  }

  if (isInvalidFilterError(error)) {
    sendJson(res, 400, {
      error: {
        code: 'invalid_filter',
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  console.error(error);
  sendJson(res, 500, {
    error: {
      code: 'internal',
      message: 'Internal server error.',
    },
  });
}

function isInvalidFilterError(value: unknown): value is Error & { code: string; details?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    (value as { code: string }).code === 'invalid_filter'
  );
}

function emptyToUndefined(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

void main().catch((error) => {
  console.error('failed to start eldapo-core', error);
  process.exitCode = 1;
});
