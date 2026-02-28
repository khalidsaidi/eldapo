import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';

export type BenchEntry = {
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

export async function forEachBenchEntry(
  file: string,
  onEntry: (entry: BenchEntry, index: number) => Promise<void>,
): Promise<number> {
  const inputPath = resolve(file);
  const stream = createReadStream(inputPath, { encoding: 'utf8' });
  const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;

  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    count += 1;
    const entry = JSON.parse(trimmed) as BenchEntry;
    await onEntry(entry, count);
  }

  return count;
}

export function firstAttr(entry: BenchEntry, key: string): string {
  return entry.attrs[key]?.[0] ?? '';
}
