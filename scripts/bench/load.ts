import 'dotenv/config';

import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';

import postgres from 'postgres';

type BenchEntry = {
  id: string;
  rev: number;
  type: string;
  namespace: string;
  name: string;
  description: string;
  version: string | null;
  attrs: Record<string, string[]>;
  manifest: Record<string, unknown>;
  meta: Record<string, unknown>;
};

const databaseUrl = process.env.DATABASE_URL ?? '';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error('Usage: pnpm bench:load --file=.ai/bench/dataset-10000.jsonl [--truncate]');
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const inputPath = resolve(args.file);

  try {
    if (args.truncate) {
      await sql.unsafe(`DELETE FROM changes WHERE id LIKE 'mcp:bench:%' OR id LIKE 'rag:bench:%' OR id LIKE 'skill:bench:%'`);
      await sql.unsafe(`DELETE FROM entries_latest WHERE namespace = 'bench'`);
      await sql.unsafe(`DELETE FROM entries WHERE namespace = 'bench'`);
      console.log('cleared existing benchmark rows from entries, entries_latest, changes');
    }

    let count = 0;
    const stream = createReadStream(inputPath, { encoding: 'utf8' });
    const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const entry = JSON.parse(trimmed) as BenchEntry;

      await sql.begin(async (tx) => {
        await tx.unsafe(
          `
            INSERT INTO entries (
              id,
              rev,
              type,
              namespace,
              name,
              description,
              version,
              attrs,
              manifest,
              meta
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8::jsonb,
              $9::jsonb,
              $10::jsonb
            )
            ON CONFLICT (id, rev) DO NOTHING
          `,
          [
            entry.id,
            entry.rev,
            entry.type,
            entry.namespace,
            entry.name,
            entry.description,
            entry.version,
            entry.attrs,
            entry.manifest,
            entry.meta,
          ] as never[],
        );

        await tx.unsafe(
          `
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
            FROM entries
            WHERE id = $1 AND rev = $2
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
            WHERE entries_latest.rev <= EXCLUDED.rev
          `,
          [entry.id, entry.rev],
        );
      });

      count += 1;
      if (count % 10_000 === 0) {
        console.log(`loaded ${count} rows...`);
      }
    }

    console.log(`loaded ${count} benchmark rows from ${inputPath}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function parseArgs(argv: string[]): { file?: string; truncate: boolean } {
  const output = {
    truncate: false,
  } as { file?: string; truncate: boolean };

  for (const arg of argv) {
    if (arg === '--truncate') {
      output.truncate = true;
      continue;
    }

    if (arg.startsWith('--file=')) {
      output.file = arg.slice('--file='.length);
    }
  }

  return output;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
