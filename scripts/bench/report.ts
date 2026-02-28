import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

type RunFile = {
  path: string;
  generatedAt: string;
  generatedAtMs: number;
  dataset: string;
  scenario: string;
  summaries: Summary[];
};

type AggregatedRow = {
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

type ParsedArgs = {
  root: string;
  dataset?: string;
  scenario?: string;
  out?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runFiles = await collectRunFiles(resolve(args.root));

  if (runFiles.length === 0) {
    throw new Error(`No run-*.json files found under ${args.root}`);
  }

  const parsed = await Promise.all(runFiles.map((path) => parseRunFile(path)));
  const filtered = parsed
    .filter((item): item is RunFile => item !== null)
    .filter((item) => (args.dataset ? item.dataset === args.dataset : true))
    .filter((item) => (args.scenario ? item.scenario === args.scenario : true));

  if (filtered.length === 0) {
    throw new Error('No run files matched requested filters.');
  }

  const rows = aggregate(filtered);
  const markdown = renderMarkdown(filtered, rows);

  if (args.out) {
    const outPath = resolve(args.out);
    await writeFile(outPath, `${markdown}\n`, 'utf8');
    console.log(`wrote benchmark report to ${outPath}`);
    return;
  }

  process.stdout.write(`${markdown}\n`);
}

function aggregate(files: RunFile[]): AggregatedRow[] {
  const grouped = new Map<string, Array<{ ts: number; summary: Summary }>>();

  for (const file of files) {
    for (const summary of file.summaries) {
      const key = [file.dataset, file.scenario, summary.target, summary.suite].join('|');
      const bucket = grouped.get(key) ?? [];
      bucket.push({ ts: file.generatedAtMs, summary });
      grouped.set(key, bucket);
    }
  }

  const rows: AggregatedRow[] = [];

  for (const [key, values] of grouped.entries()) {
    const [dataset, scenario, target, suite] = key.split('|');
    const sorted = [...values].sort((left, right) => left.ts - right.ts);
    const trimmed = sorted.length > 1 ? sorted.slice(1) : sorted;

    rows.push({
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

  return rows.sort((left, right) => {
    return [left.dataset, left.scenario, left.target, left.suite].join('|').localeCompare(
      [right.dataset, right.scenario, right.target, right.suite].join('|'),
    );
  });
}

function renderMarkdown(files: RunFile[], rows: AggregatedRow[]): string {
  const lines: string[] = [];

  const generatedAtMin = files.reduce((min, item) => Math.min(min, item.generatedAtMs), Number.POSITIVE_INFINITY);
  const generatedAtMax = files.reduce((max, item) => Math.max(max, item.generatedAtMs), 0);

  lines.push('# Benchmark Summary');
  lines.push('');
  lines.push(`- Window: ${new Date(generatedAtMin).toISOString()} to ${new Date(generatedAtMax).toISOString()}`);
  lines.push(`- Run files: ${files.length}`);
  lines.push('- Aggregation: median of runs 2-5 per suite/target (run 1 discarded as warmup).');
  lines.push('');

  const grouped = new Map<string, AggregatedRow[]>();

  for (const row of rows) {
    const key = `${row.dataset}|${row.scenario}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  for (const [groupKey, groupRows] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [dataset, scenario] = groupKey.split('|');
    const sample = groupRows[0];

    lines.push(`## Dataset ${dataset} / ${scenario}`);
    lines.push('');
    lines.push(`- Samples per suite/target: ${sample.samples}`);
    lines.push(`- Used for median: ${sample.usedSamples}`);
    lines.push('');
    lines.push('| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |');

    for (const row of groupRows.sort(compareRows)) {
      lines.push(
        `| ${row.target} | ${row.suite} | ${formatNum(row.p50Ms)} | ${formatNum(row.p95Ms)} | ${formatNum(row.p99Ms)} | ${formatNum(row.reqPerSec)} |`,
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

function compareRows(left: AggregatedRow, right: AggregatedRow): number {
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

async function parseRunFile(path: string): Promise<RunFile | null> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    generated_at?: string;
    dataset?: string | null;
    scenario?: string | null;
    summaries?: Summary[];
  };

  if (!raw.generated_at || !Array.isArray(raw.summaries)) {
    return null;
  }

  return {
    path,
    generatedAt: raw.generated_at,
    generatedAtMs: Date.parse(raw.generated_at),
    dataset: raw.dataset ?? 'unknown',
    scenario: raw.scenario ?? 'default',
    summaries: raw.summaries,
  };
}

async function collectRunFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

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

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    root: '.ai/bench',
  };

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
      continue;
    }

    if (arg.startsWith('--out=')) {
      parsed.out = arg.slice('--out='.length);
    }
  }

  return parsed;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
