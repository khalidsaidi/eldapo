import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { createClient } from 'redis';

import { eqKey, presenceKey, tempKey, UNIVERSE_KEY } from '@/competitors/redisSets/keys';
import type { FilterNode } from '@/lib/filter/ast';
import { resolveFilterKey } from '@/lib/filter/compileToSql';
import { parseFilter } from '@/lib/filter/parser';

const host = process.env.ELDAPPO_RACE_REDIS_SETS_HOST ?? '127.0.0.1';
const port = Number(process.env.ELDAPPO_RACE_REDIS_SETS_PORT ?? 4201);
const redisUrl = process.env.ELDAPPO_RACE_REDIS_SETS_URL ?? 'redis://127.0.0.1:6379';

type EvalContext = {
  requestId: string;
  tempIndex: number;
  tempKeys: string[];
};

async function main(): Promise<void> {
  const client = createClient({ url: redisUrl });

  client.on('error', (error) => {
    console.error('redis_sets server client error', error);
  });

  await client.connect();

  const server = createServer((req, res) => {
    void handleRequest(client, req, res);
  });

  server.listen(port, host, () => {
    console.log(`redis_sets race server listening on http://${host}:${port}`);
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

  let ast: FilterNode | null = null;

  try {
    ast = rawFilter ? parseFilter(rawFilter) : null;
  } catch (error) {
    sendJson(res, 400, {
      error: 'invalid_filter',
      message: error instanceof Error ? error.message : 'Invalid filter.',
    });
    return;
  }

  const context: EvalContext = {
    requestId: randomUUID(),
    tempIndex: 0,
    tempKeys: [],
  };

  try {
    const resultKey = ast ? await evaluateAst(client, ast, context) : UNIVERSE_KEY;
    const count = Number(await client.sCard(resultKey));
    const ids = limit > 0 ? await scanIds(client, resultKey, limit) : [];

    sendJson(res, 200, {
      ids,
      count,
    });
  } catch (error) {
    console.error('redis_sets request failed', error);
    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Search failed.',
    });
  } finally {
    if (context.tempKeys.length > 0) {
      await client.del(context.tempKeys);
    }
  }
}

async function evaluateAst(
  client: ReturnType<typeof createClient>,
  node: FilterNode,
  context: EvalContext,
): Promise<string> {
  switch (node.kind) {
    case 'eq': {
      const resolved = resolveFilterKey(node.key);

      if (resolved.kind === 'top') {
        return eqKey('top', resolved.field, node.value);
      }

      return eqKey('attr', resolved.key, node.value);
    }

    case 'present': {
      const resolved = resolveFilterKey(node.key);

      if (resolved.kind === 'top') {
        return presenceKey('top', resolved.field);
      }

      return presenceKey('attr', resolved.key);
    }

    case 'and': {
      const childKeys = await Promise.all(node.children.map((child) => evaluateAst(client, child, context)));
      if (childKeys.length === 1) {
        return childKeys[0];
      }

      const outKey = nextTempKey(context);
      await client.sInterStore(outKey, childKeys);
      await client.expire(outKey, 2);
      return outKey;
    }

    case 'or': {
      const childKeys = await Promise.all(node.children.map((child) => evaluateAst(client, child, context)));
      if (childKeys.length === 1) {
        return childKeys[0];
      }

      const outKey = nextTempKey(context);
      await client.sUnionStore(outKey, childKeys);
      await client.expire(outKey, 2);
      return outKey;
    }

    case 'not': {
      const childKey = await evaluateAst(client, node.child, context);
      const outKey = nextTempKey(context);
      await client.sDiffStore(outKey, [UNIVERSE_KEY, childKey]);
      await client.expire(outKey, 2);
      return outKey;
    }

    default: {
      const impossible: never = node;
      throw new Error(`Unknown filter kind ${(impossible as { kind: string }).kind}`);
    }
  }
}

async function scanIds(client: ReturnType<typeof createClient>, resultKey: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let cursor = '0';
  const count = Math.max(200, limit * 50);

  do {
    const batch = await client.sScan(resultKey, cursor, { COUNT: count });
    cursor = batch.cursor;

    for (const member of batch.members) {
      if (seen.has(member)) {
        continue;
      }

      seen.add(member);
      ids.push(member);

      if (ids.length >= limit) {
        return ids;
      }
    }
  } while (cursor !== '0');

  return ids;
}

function nextTempKey(context: EvalContext): string {
  context.tempIndex += 1;
  const key = tempKey(context.requestId, context.tempIndex);
  context.tempKeys.push(key);
  return key;
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
