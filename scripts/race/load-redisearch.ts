import { createClient } from 'redis';

import { firstAttr, forEachBenchEntry } from './common';

type Args = {
  file?: string;
  flush: boolean;
  url: string;
  batchSize: number;
};

const INDEX_NAME = 'bench_idx';
const DOC_PREFIX = 'bench:doc:';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    throw new Error(
      'Usage: pnpm race:load:redisearch --file=.ai/bench/dataset-100000.jsonl [--flush] [--url=redis://127.0.0.1:6380] [--batch-size=2000]',
    );
  }

  const client = createClient({ url: args.url });

  client.on('error', (error) => {
    console.error('redisearch loader client error', error);
  });

  await client.connect();

  try {
    if (args.flush) {
      await dropIndex(client, true);
      const removed = await flushDocKeys(client);
      console.log(`removed ${removed} existing bench:doc:* keys from redisearch`);
    }

    await createIndex(client);

    let pipeline = client.multi();
    let pendingEntries = 0;
    let loaded = 0;

    const count = await forEachBenchEntry(args.file, async (entry, index) => {
      const key = `${DOC_PREFIX}${entry.id}`;

      pipeline.hSet(key, {
        id: entry.id,
        type: entry.type,
        env: firstAttr(entry, 'env'),
        status: firstAttr(entry, 'status'),
        visibility: firstAttr(entry, 'visibility'),
        tag: (entry.attrs.tag ?? []).join(','),
        capability: (entry.attrs.capability ?? []).join(','),
        endpoint: (entry.attrs.endpoint ?? []).join(','),
        namespace: entry.namespace,
      });

      pendingEntries += 1;

      if (pendingEntries < args.batchSize) {
        return;
      }

      await pipeline.exec();
      loaded += pendingEntries;
      pendingEntries = 0;
      pipeline = client.multi();

      if (loaded % 10_000 === 0 || index === loaded) {
        console.log(`loaded ${loaded} entries into redisearch...`);
      }
    });

    if (pendingEntries > 0) {
      await pipeline.exec();
      loaded += pendingEntries;
      pendingEntries = 0;
    }

    console.log(`loaded ${loaded} redisearch documents from ${args.file} (lines read: ${count})`);
  } finally {
    await client.quit();
  }
}

async function dropIndex(client: ReturnType<typeof createClient>, withDocs: boolean): Promise<void> {
  const args = ['FT.DROPINDEX', INDEX_NAME];
  if (withDocs) {
    args.push('DD');
  }

  try {
    await client.sendCommand(args);
  } catch (error) {
    if (!isUnknownIndexError(error)) {
      throw error;
    }
  }
}

async function createIndex(client: ReturnType<typeof createClient>): Promise<void> {
  await dropIndex(client, true);

  await client.sendCommand([
    'FT.CREATE',
    INDEX_NAME,
    'ON',
    'HASH',
    'PREFIX',
    '1',
    DOC_PREFIX,
    'SCHEMA',
    'id',
    'TEXT',
    'type',
    'TAG',
    'env',
    'TAG',
    'status',
    'TAG',
    'visibility',
    'TAG',
    'tag',
    'TAG',
    'capability',
    'TAG',
    'namespace',
    'TAG',
    'endpoint',
    'TEXT',
  ]);
}

async function flushDocKeys(client: ReturnType<typeof createClient>): Promise<number> {
  let removed = 0;
  let chunk: string[] = [];

  for await (const key of client.scanIterator({ MATCH: `${DOC_PREFIX}*`, COUNT: 1000 })) {
    chunk.push(String(key));

    if (chunk.length < 1000) {
      continue;
    }

    removed += chunk.length;
    await client.del(chunk);
    chunk = [];
  }

  if (chunk.length > 0) {
    removed += chunk.length;
    await client.del(chunk);
  }

  return removed;
}

function isUnknownIndexError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes('unknown index name');
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    flush: false,
    url: 'redis://127.0.0.1:6380',
    batchSize: 2000,
  };

  for (const arg of argv) {
    if (arg === '--flush') {
      parsed.flush = true;
      continue;
    }

    if (arg.startsWith('--file=')) {
      parsed.file = arg.slice('--file='.length);
      continue;
    }

    if (arg.startsWith('--url=')) {
      parsed.url = arg.slice('--url='.length);
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      const value = Number(arg.slice('--batch-size='.length));
      if (Number.isInteger(value) && value > 0) {
        parsed.batchSize = value;
      }
    }
  }

  return parsed;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
