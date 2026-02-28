import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BenchEntry = {
  id: string;
  rev: number;
  type: 'skill' | 'rag' | 'mcp';
  namespace: string;
  name: string;
  description: string;
  version: string;
  attrs: Record<string, string[]>;
  manifest: Record<string, unknown>;
  meta: Record<string, unknown>;
};

const DEFAULT_SIZES = [10_000, 100_000, 1_000_000];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sizes = args.sizes ?? DEFAULT_SIZES;
  const outputDir = resolve(args.outDir ?? '.ai/bench');

  await mkdir(outputDir, { recursive: true });

  for (const size of sizes) {
    const outputPath = resolve(outputDir, `dataset-${size}.jsonl`);
    await mkdir(dirname(outputPath), { recursive: true });

    const stream = createWriteStream(outputPath, { encoding: 'utf8' });

    for (let index = 0; index < size; index += 1) {
      const entry = generateEntry(index);
      if (!stream.write(`${JSON.stringify(entry)}\n`)) {
        await onceDrain(stream);
      }
    }

    await new Promise<void>((resolvePromise, reject) => {
      stream.on('error', reject);
      stream.end(() => resolvePromise());
    });

    console.log(`generated ${size} entries -> ${outputPath}`);
  }
}

export function generateEntry(index: number): BenchEntry {
  const type: BenchEntry['type'] = pickType(index);
  const id = `${type}:bench:${String(index).padStart(9, '0')}`;

  const capability =
    type === 'rag' ? pickOne(index, ['retrieve', 'embed', 'rerank']) : pickOne(index, ['summarize', 'extract', 'classify']);
  // Use a coprime step so all tags cycle evenly (gcd(5, 6) = 1).
  const tag = pickOne(index * 5, ['finance', 'pdf', 'docs', 'search', 'code', 'support']);
  const env = pickOne(index * 7, ['prod', 'staging', 'dev']);
  const visibility = index % 20 === 0 ? 'restricted' : index % 8 === 0 ? 'internal' : 'public';

  const attrs: Record<string, string[]> = {
    capability: [capability],
    tag: [tag],
    env: [env],
    status: ['active'],
    visibility: [visibility],
    endpoint: [`https://${type}.bench.local/${index}`],
    owner: ['bench-team'],
  };

  if (visibility === 'restricted') {
    attrs.allowed_group = [pickOne(index * 11, ['eng', 'finance', 'ops'])];
  }

  return {
    id,
    rev: 1,
    type,
    namespace: 'bench',
    name: `${type.toUpperCase()} Bench ${index}`,
    description: `Synthetic ${type} benchmark capability ${index}`,
    version: '1.0.0',
    attrs,
    manifest: {
      endpoint: `https://${type}.bench.local/${index}`,
      protocol: type === 'mcp' ? 'mcp' : 'http',
    },
    meta: {
      source: 'bench-generate',
      index,
    },
  };
}

function pickType(index: number): BenchEntry['type'] {
  const mod = index % 10;

  if (mod < 6) {
    return 'skill';
  }

  if (mod < 8) {
    return 'rag';
  }

  return 'mcp';
}

function pickOne<T>(seed: number, values: T[]): T {
  return values[Math.abs(seed) % values.length];
}

function parseArgs(argv: string[]): { sizes?: number[]; outDir?: string } {
  const parsed: { sizes?: number[]; outDir?: string } = {};

  for (const arg of argv) {
    if (arg.startsWith('--sizes=')) {
      const raw = arg.slice('--sizes='.length);
      parsed.sizes = raw
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length);
    }
  }

  return parsed;
}

async function onceDrain(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    stream.once('drain', () => resolvePromise());
  });
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;

if (isMain) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
