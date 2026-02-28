import { createServer } from 'node:http';

import { createClient } from 'redis';

import type { FilterNode } from '@/lib/filter/ast';
import { resolveFilterKey } from '@/lib/filter/compileToSql';
import { parseFilter } from '@/lib/filter/parser';

const host = process.env.ELDAPPO_RACE_REDISEARCH_HOST ?? '127.0.0.1';
const port = Number(process.env.ELDAPPO_RACE_REDISEARCH_PORT ?? 4202);
const redisUrl = process.env.ELDAPPO_RACE_REDISEARCH_URL ?? 'redis://127.0.0.1:6380';

const INDEX_NAME = 'bench_idx';
const DOC_PREFIX = 'bench:doc:';
const MATCH_ALL = '*';
const NO_MATCH = '@id:"__eldapo_no_match__"';

type FieldKind = 'tag' | 'text';

type FieldMapping = {
  field: string;
  kind: FieldKind;
};

async function main(): Promise<void> {
  const client = createClient({ url: redisUrl });

  client.on('error', (error) => {
    console.error('redisearch server client error', error);
  });

  await client.connect();

  const server = createServer((req, res) => {
    void handleRequest(client, req, res);
  });

  server.listen(port, host, () => {
    console.log(`redisearch race server listening on http://${host}:${port}`);
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await client.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}

async function handleRequest(
  client: ReturnType<typeof createClient>,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const origin = `http://${req.headers.host ?? `${host}:${port}`}`;
  const url = new URL(req.url ?? '/', origin);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'GET' || url.pathname !== '/search') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const rawLimit = Number(url.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 0), 200) : 20;
  const rawFilter = url.searchParams.get('filter');

  let query = MATCH_ALL;

  try {
    if (rawFilter) {
      const ast = parseFilter(rawFilter);
      query = compileNode(ast);
    }
  } catch (error) {
    sendJson(res, 400, {
      error: 'invalid_filter',
      message: error instanceof Error ? error.message : 'Invalid filter.',
    });
    return;
  }

  try {
    const raw = (await client.sendCommand([
      'FT.SEARCH',
      INDEX_NAME,
      query,
      'NOCONTENT',
      'LIMIT',
      '0',
      String(limit),
    ])) as unknown;

    const { ids, count } = parseSearchReply(raw);

    sendJson(res, 200, {
      ids,
      count,
    });
  } catch (error) {
    console.error('redisearch request failed', error);
    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Search failed.',
    });
  }
}

function parseSearchReply(raw: unknown): { ids: string[]; count: number } {
  if (!Array.isArray(raw)) {
    return { ids: [], count: 0 };
  }

  const count = Number(raw[0] ?? 0);
  const ids: string[] = [];

  for (const item of raw.slice(1)) {
    const key = String(item);
    if (!key.startsWith(DOC_PREFIX)) {
      continue;
    }

    ids.push(key.slice(DOC_PREFIX.length));
  }

  return {
    ids,
    count: Number.isFinite(count) ? count : 0,
  };
}

function compileNode(node: FilterNode): string {
  switch (node.kind) {
    case 'eq': {
      const mapping = resolveField(node.key);
      if (!mapping) {
        return NO_MATCH;
      }

      if (mapping.kind === 'tag') {
        return `@${mapping.field}:{${escapeTagValue(node.value)}}`;
      }

      return `@${mapping.field}:"${escapeTextValue(node.value)}"`;
    }

    case 'present': {
      const mapping = resolveField(node.key);
      if (!mapping) {
        return MATCH_ALL;
      }

      // RediSearch TEXT presence syntax is version-sensitive; treat presence as match-all best-effort.
      return MATCH_ALL;
    }

    case 'and': {
      const parts = node.children.map((child) => compileNode(child));

      if (parts.includes(NO_MATCH)) {
        return NO_MATCH;
      }

      const meaningful = parts.filter((part) => part !== MATCH_ALL);
      if (meaningful.length === 0) {
        return MATCH_ALL;
      }

      if (meaningful.length === 1) {
        return meaningful[0];
      }

      return meaningful.join(' ');
    }

    case 'or': {
      const parts = node.children.map((child) => compileNode(child));
      if (parts.includes(MATCH_ALL)) {
        return MATCH_ALL;
      }

      const meaningful = parts.filter((part) => part !== NO_MATCH);
      if (meaningful.length === 0) {
        return NO_MATCH;
      }

      if (meaningful.length === 1) {
        return meaningful[0];
      }

      return `(${meaningful.join('|')})`;
    }

    case 'not': {
      const part = compileNode(node.child);
      if (part === NO_MATCH) {
        return MATCH_ALL;
      }

      if (part === MATCH_ALL) {
        return NO_MATCH;
      }

      return `-${wrapQuery(part)}`;
    }

    default: {
      const impossible: never = node;
      throw new Error(`Unsupported filter kind ${(impossible as { kind: string }).kind}`);
    }
  }
}

function wrapQuery(query: string): string {
  if (query.startsWith('(') && query.endsWith(')')) {
    return query;
  }

  return `(${query})`;
}

function resolveField(rawKey: string): FieldMapping | null {
  const resolved = resolveFilterKey(rawKey);

  if (resolved.kind === 'top') {
    if (resolved.field === 'type') {
      return { field: 'type', kind: 'tag' };
    }

    if (resolved.field === 'namespace') {
      return { field: 'namespace', kind: 'tag' };
    }

    if (resolved.field === 'id') {
      return { field: 'id', kind: 'text' };
    }

    return null;
  }

  switch (resolved.key) {
    case 'type':
      return { field: 'type', kind: 'tag' };
    case 'env':
      return { field: 'env', kind: 'tag' };
    case 'status':
      return { field: 'status', kind: 'tag' };
    case 'visibility':
      return { field: 'visibility', kind: 'tag' };
    case 'tag':
      return { field: 'tag', kind: 'tag' };
    case 'capability':
      return { field: 'capability', kind: 'tag' };
    case 'namespace':
      return { field: 'namespace', kind: 'tag' };
    case 'endpoint':
      return { field: 'endpoint', kind: 'text' };
    case 'id':
      return { field: 'id', kind: 'text' };
    default:
      return null;
  }
}

function escapeTagValue(value: string): string {
  return value.replace(/[\\,./<>{}\[\]"':;!@#$%^&*()\-+=~|\s]/g, '\\$&');
}

function escapeTextValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
