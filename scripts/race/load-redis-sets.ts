import { createClient } from 'redis';

import { eqKey, presenceKey, UNIVERSE_KEY } from '@/competitors/redisSets/keys';

import { forEachBenchEntry } from './common';

type Args = {
  file?: string;
  flush: boolean;
  url: string;
  batchSize: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    throw new Error(
      'Usage: pnpm race:load:redis-sets --file=.ai/bench/dataset-100000.jsonl [--flush] [--url=redis://127.0.0.1:6379] [--batch-size=2000]',
    );
  }

  const client = createClient({ url: args.url });

  client.on('error', (error) => {
    console.error('redis_sets loader client error', error);
  });

  await client.connect();

  try {
    if (args.flush) {
      const removed = await flushBenchKeys(client);
      console.log(`removed ${removed} existing bench:* keys from redis_sets`);
    }

    let pendingEntries = 0;
    let loaded = 0;
    let pipeline = client.multi();

    const count = await forEachBenchEntry(args.file, async (entry, index) => {
      queueEntry(pipeline, entry);
      pendingEntries += 1;

      if (pendingEntries < args.batchSize) {
        return;
      }

      await pipeline.exec();
      loaded += pendingEntries;
      pendingEntries = 0;
      pipeline = client.multi();

      if (loaded % 10_000 === 0 || index === loaded) {
        console.log(`loaded ${loaded} entries into redis_sets...`);
      }
    });

    if (pendingEntries > 0) {
      await pipeline.exec();
      loaded += pendingEntries;
      pendingEntries = 0;
    }

    console.log(`loaded ${loaded} redis_sets entries from ${args.file} (lines read: ${count})`);
  } finally {
    await client.quit();
  }
}

function queueEntry(
  pipeline: ReturnType<ReturnType<typeof createClient>['multi']>,
  entry: {
    id: string;
    rev: number;
    type: string;
    namespace: string;
    name: string;
    version: string | null;
    attrs: Record<string, string[]>;
  },
): void {
  pipeline.sAdd(UNIVERSE_KEY, entry.id);

  addTopLevelToken(pipeline, entry.id, 'id', entry.id);
  addTopLevelToken(pipeline, entry.id, 'type', entry.type);
  addTopLevelToken(pipeline, entry.id, 'namespace', entry.namespace);
  addTopLevelToken(pipeline, entry.id, 'name', entry.name);
  addTopLevelToken(pipeline, entry.id, 'rev', String(entry.rev));

  if (entry.version) {
    addTopLevelToken(pipeline, entry.id, 'version', entry.version);
  }

  for (const [key, values] of Object.entries(entry.attrs)) {
    pipeline.sAdd(presenceKey('attr', key), entry.id);

    for (const value of values) {
      pipeline.sAdd(eqKey('attr', key, value), entry.id);
    }
  }
}

function addTopLevelToken(
  pipeline: ReturnType<ReturnType<typeof createClient>['multi']>,
  id: string,
  key: string,
  value: string,
): void {
  if (!value) {
    return;
  }

  pipeline.sAdd(eqKey('top', key, value), id);
  pipeline.sAdd(presenceKey('top', key), id);
}

async function flushBenchKeys(client: ReturnType<typeof createClient>): Promise<number> {
  let removed = 0;
  let chunk: string[] = [];

  for await (const key of client.scanIterator({ MATCH: 'bench:*', COUNT: 1000 })) {
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

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    flush: false,
    url: 'redis://127.0.0.1:6379',
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
