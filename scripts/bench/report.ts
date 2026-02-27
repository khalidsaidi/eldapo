import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type RunFile = {
  path: string;
  dataset: string;
  scenario: string;
  generatedAt: string;
  generatedAtMs: number;
  duration: number;
  connections: number;
  summaries: Summary[];
};

type Summary = {
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

type Aggregated = {
  dataset: string;
  scenario: string;
  target: string;
  suite: string;
  endpoint: string;
  samples: number;
  usedSamples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  reqPerSec: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root ?? '.ai/bench/results');

  const files = await collectRunFiles(root);
  if (files.length === 0) {
    throw new Error(`No benchmark run files found under ${root}`);
  }

  const parsed = await Promise.all(files.map((path) => parseRunFile(path, root)));
  const filtered = parsed
    .filter(Boolean)
    .filter((item): item is RunFile => item !== null)
    .filter((item) => (args.dataset ? item.dataset === args.dataset : true))
    .filter((item) => (args.scenario ? item.scenario === args.scenario : true));

  if (filtered.length === 0) {
    throw new Error('No run files matched filters.');
  }

  const aggregated = aggregate(filtered);
  const markdown = renderMarkdown(filtered, aggregated);
  process.stdout.write(`${markdown}\n`);
}

function aggregate(files: RunFile[]): Aggregated[] {
  const byKey = new Map<string, Array<{ ts: number; summary: Summary }>>();

  for (const file of files) {
    for (const summary of file.summaries) {
      const key = [file.dataset, file.scenario, summary.target, summary.suite].join('|');
      const bucket = byKey.get(key) ?? [];
      bucket.push({ ts: file.generatedAtMs, summary });
      byKey.set(key, bucket);
    }
  }

  const output: Aggregated[] = [];

  for (const [key, values] of byKey.entries()) {
    const [dataset, scenario, target, suite] = key.split('|');
    const sorted = [...values].sort((left, right) => left.ts - right.ts);
    const trimmed = sorted.length > 1 ? sorted.slice(1) : sorted;

    output.push({
      dataset,
      scenario,
      target,
      suite,
      endpoint: sorted[0]?.summary.endpoint ?? '',
      samples: sorted.length,
      usedSamples: trimmed.length,
      p50Ms: median(trimmed.map((item) => item.summary.p50_ms)),
      p95Ms: median(trimmed.map((item) => item.summary.p95_ms)),
      p99Ms: median(trimmed.map((item) => item.summary.p99_ms)),
      reqPerSec: median(trimmed.map((item) => item.summary.req_per_sec_avg)),
    });
  }

  return output.sort((left, right) => {
    return [left.dataset, left.scenario, left.target, left.suite].join('|').localeCompare(
      [right.dataset, right.scenario, right.target, right.suite].join('|'),
    );
  });
}

function renderMarkdown(files: RunFile[], rows: Aggregated[]): string {
  const grouped = new Map<string, Aggregated[]>();
  for (const row of rows) {
    const key = `${row.dataset}|${row.scenario}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const lines: string[] = [];
  lines.push('# Benchmark Summary');
  lines.push('');

  const generatedAtMin = files.reduce((min, item) => Math.min(min, item.generatedAtMs), Number.POSITIVE_INFINITY);
  const generatedAtMax = files.reduce((max, item) => Math.max(max, item.generatedAtMs), 0);

  lines.push(`- Window: ${new Date(generatedAtMin).toISOString()} to ${new Date(generatedAtMax).toISOString()}`);
  lines.push(`- Total run files: ${files.length}`);
  lines.push('- Aggregation: median of runs 2-5 (first run discarded as warmup)');
  lines.push('');

  for (const [groupKey, groupRows] of [...grouped.entries()].sort()) {
    const [dataset, scenario] = groupKey.split('|');
    const example = groupRows[0];

    lines.push(`## Dataset ${dataset} / ${scenario}`);
    lines.push('');
    lines.push(`- Samples per suite-target: ${example.samples}`);
    lines.push(`- Used for median: ${example.usedSamples}`);
    lines.push('');
    lines.push('| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |');

    for (const row of groupRows.sort(compareRows)) {
      lines.push(
        `| ${row.target} | ${row.suite} | ${formatNum(row.p50Ms)} | ${formatNum(row.p95Ms)} | ${formatNum(row.p99Ms)} | ${formatNum(row.reqPerSec)} |`,
      );
    }

    const sqlRows = groupRows.filter((row) => row.target === 'sql');
    const coreRows = groupRows.filter((row) => row.target === 'core');

    if (sqlRows.length > 0 && coreRows.length > 0) {
      lines.push('');
      lines.push('| suite | p95 speedup (sql/core) | req/s speedup (core/sql) |');
      lines.push('| --- | ---: | ---: |');

      for (const sql of sqlRows.sort(compareRows)) {
        const core = coreRows.find((row) => row.suite === sql.suite);
        if (!core || core.p95Ms === 0 || sql.reqPerSec === 0) {
          continue;
        }

        const p95Speedup = sql.p95Ms / core.p95Ms;
        const reqSpeedup = core.reqPerSec / sql.reqPerSec;
        lines.push(`| ${sql.suite} | ${formatNum(p95Speedup)}x | ${formatNum(reqSpeedup)}x |`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function compareRows(left: Aggregated, right: Aggregated): number {
  return [left.target, left.suite].join('|').localeCompare([right.target, right.suite].join('|'));
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

async function parseRunFile(path: string, root: string): Promise<RunFile | null> {
  const relative = path.slice(root.length + 1);
  const parts = relative.split('/');

  if (parts.length < 3) {
    return null;
  }

  const [dataset, scenario] = parts;
  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    generated_at: string;
    duration: number;
    connections: number;
    summaries: Summary[];
  };

  return {
    path,
    dataset,
    scenario,
    generatedAt: raw.generated_at,
    generatedAtMs: Date.parse(raw.generated_at),
    duration: raw.duration,
    connections: raw.connections,
    summaries: raw.summaries,
  };
}

async function collectRunFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.startsWith('run-') && entry.name.endsWith('.json')) {
        found.push(fullPath);
      }
    }
  }

  await walk(root);
  return found.sort();
}

function parseArgs(argv: string[]): {
  root?: string;
  dataset?: string;
  scenario?: string;
} {
  const parsed: {
    root?: string;
    dataset?: string;
    scenario?: string;
  } = {};

  for (const arg of argv) {
    if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
      continue;
    }

    if (arg.startsWith('--dataset=')) {
      parsed.dataset = arg.slice('--dataset='.length);
      continue;
    }

    if (arg.startsWith('--scenario=')) {
      parsed.scenario = arg.slice('--scenario='.length);
    }
  }

  return parsed;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
