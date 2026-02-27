import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import autocannon from 'autocannon';

type Suite = {
  name: string;
  filter: string;
};

type RunSummary = {
  target: string;
  endpoint: string;
  suite: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  req_per_sec_avg: number;
  bytes_per_sec_avg: number;
};

const suites: Suite[] = [
  { name: 'skill_summarize_prod', filter: '(&(type=skill)(capability=summarize)(env=prod))' },
  {
    name: 'rag_finance_active',
    filter: '(&(type=rag)(capability=retrieve)(tag=finance)(status=active))',
  },
  { name: 'tag_pdf', filter: '(tag=pdf)' },
  { name: 'endpoint_presence', filter: '(endpoint=*)' },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const duration = args.duration ?? 10;
  const connections = args.connections ?? 20;

  const targets = [
    {
      name: 'sql',
      url: args.sqlUrl ?? 'http://127.0.0.1:3000/v1/search',
      enabled: args.only ? args.only === 'sql' : true,
    },
    {
      name: 'core',
      url: args.coreUrl ?? 'http://127.0.0.1:4100/core/search',
      enabled: args.only ? args.only === 'core' : true,
    },
  ].filter((target) => target.enabled);

  const summaries: RunSummary[] = [];

  for (const target of targets) {
    for (const suite of suites) {
      const benchUrl = new URL(target.url);
      benchUrl.searchParams.set('filter', suite.filter);
      benchUrl.searchParams.set('limit', String(args.limit ?? 20));

      console.log(`running ${target.name} ${suite.name} -> ${benchUrl.toString()}`);
      const result = await runAutocannon({
        url: benchUrl.toString(),
        duration,
        connections,
      });

      const summary: RunSummary = {
        target: target.name,
        endpoint: target.url,
        suite: suite.name,
        p50_ms: result.latency.p50,
        p95_ms: readP95(result.latency),
        p99_ms: result.latency.p99,
        avg_ms: result.latency.average,
        req_per_sec_avg: result.requests.average,
        bytes_per_sec_avg: result.throughput.average,
      };

      summaries.push(summary);
      console.log(summary);
    }
  }

  const outputDir = resolve(args.outDir ?? '.ai/bench');
  await mkdir(outputDir, { recursive: true });

  const outputPath = resolve(outputDir, `run-${Date.now()}.json`);
  await writeFile(
    outputPath,
    `${JSON.stringify({ generated_at: new Date().toISOString(), duration, connections, summaries }, null, 2)}\n`,
    'utf8',
  );

  console.log(`wrote benchmark summary to ${outputPath}`);
}

async function runAutocannon(options: {
  url: string;
  duration: number;
  connections: number;
}): Promise<autocannon.Result> {
  return await new Promise((resolve, reject) => {
    autocannon(
      {
        url: options.url,
        duration: options.duration,
        connections: options.connections,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('autocannon failed'));
          return;
        }

        resolve(result);
      },
    );
  });
}

function readP95(histogram: autocannon.Histogram): number {
  const asRecord = histogram as unknown as Record<string, number>;
  if (typeof asRecord.p95 === 'number') {
    return asRecord.p95;
  }

  return histogram.p97_5;
}

function parseArgs(argv: string[]): {
  sqlUrl?: string;
  coreUrl?: string;
  outDir?: string;
  only?: 'sql' | 'core';
  duration?: number;
  connections?: number;
  limit?: number;
} {
  const parsed: {
    sqlUrl?: string;
    coreUrl?: string;
    outDir?: string;
    only?: 'sql' | 'core';
    duration?: number;
    connections?: number;
    limit?: number;
  } = {};

  for (const arg of argv) {
    if (arg.startsWith('--sql-url=')) {
      parsed.sqlUrl = arg.slice('--sql-url='.length);
      continue;
    }

    if (arg.startsWith('--core-url=')) {
      parsed.coreUrl = arg.slice('--core-url='.length);
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length);
      continue;
    }

    if (arg.startsWith('--only=')) {
      const value = arg.slice('--only='.length);
      if (value === 'sql' || value === 'core') {
        parsed.only = value;
      }
      continue;
    }

    if (arg.startsWith('--duration=')) {
      parsed.duration = Number(arg.slice('--duration='.length));
      continue;
    }

    if (arg.startsWith('--connections=')) {
      parsed.connections = Number(arg.slice('--connections='.length));
      continue;
    }

    if (arg.startsWith('--limit=')) {
      parsed.limit = Number(arg.slice('--limit='.length));
    }
  }

  return parsed;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
