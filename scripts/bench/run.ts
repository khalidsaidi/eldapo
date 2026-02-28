import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import autocannon from 'autocannon';

type Suite = {
  name: string;
  filter: string;
  selectivityNote: string;
};

type TargetConfig = {
  name: string;
  url: string;
  validateCoreHeader?: boolean;
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

// Keep historical defaults for backward compatibility.
const DEFAULT_TARGETS = ['sql', 'core'];

const suites: Suite[] = [
  {
    name: 'skill_summarize_prod',
    filter: '(&(type=skill)(capability=summarize)(env=prod))',
    selectivityNote: 'selective multi-clause conjunction',
  },
  {
    name: 'rag_finance_active',
    filter: '(&(type=rag)(capability=retrieve)(tag=finance)(status=active))',
    selectivityNote: 'selective multi-clause conjunction',
  },
  {
    name: 'tag_support',
    filter: '(tag=support)',
    selectivityNote: 'broad single-attribute equality',
  },
  {
    name: 'endpoint_presence',
    filter: '(endpoint=*)',
    selectivityNote: 'very broad presence query',
  },
  {
    name: 'tag_never',
    filter: '(tag=__never__)',
    selectivityNote: 'zero-hit control query',
  },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const duration = args.duration ?? 10;
  const connections = args.connections ?? 20;
  const limit = args.limit ?? 20;

  const targetMap = new Map<string, TargetConfig>();

  for (const target of buildBuiltinTargets(args)) {
    targetMap.set(target.name, target);
  }

  for (const target of args.customTargets) {
    targetMap.set(target.name, target);
  }

  let selectedTargetNames: string[];
  if (args.targets && args.targets.length > 0) {
    selectedTargetNames = args.targets;
  } else if (args.only) {
    selectedTargetNames = [args.only];
  } else if (args.customTargets.length > 0) {
    selectedTargetNames = args.customTargets.map((target) => target.name);
  } else {
    selectedTargetNames = DEFAULT_TARGETS;
  }

  const targets: TargetConfig[] = [];
  for (const targetName of selectedTargetNames) {
    const target = targetMap.get(targetName);
    if (!target) {
      throw new Error(`Unknown target "${targetName}". Pass --target=name,url or use a builtin target.`);
    }

    targets.push(target);
  }

  if (targets.length === 0) {
    throw new Error('No targets selected.');
  }

  const summaries: RunSummary[] = [];

  for (const target of targets) {
    if (target.validateCoreHeader) {
      await validateForwardedTargetHeader(target, limit, args.raceMode);
    }

    for (const suite of suites) {
      const benchUrl = new URL(target.url);
      benchUrl.searchParams.set('filter', suite.filter);
      benchUrl.searchParams.set('limit', String(limit));
      if (args.raceMode) {
        benchUrl.searchParams.set('view', 'ids');
        benchUrl.searchParams.set('sort', 'none');
      }

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
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        dataset: args.dataset ?? null,
        scenario: args.scenario ?? null,
        duration,
        connections,
        limit,
        targets: selectedTargetNames,
        race_mode: args.raceMode,
        suites,
        summaries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`wrote benchmark summary to ${outputPath}`);
}

function buildBuiltinTargets(args: ParsedArgs): TargetConfig[] {
  return [
    {
      name: 'sql',
      url: args.sqlUrl ?? 'http://127.0.0.1:3000/v1/search',
    },
    {
      name: 'core',
      url: args.coreUrl ?? 'http://127.0.0.1:4100/core/search',
    },
    {
      name: 'v1_forwarded',
      url: args.v1ForwardedUrl ?? 'http://127.0.0.1:3000/v1/search',
      validateCoreHeader: true,
    },
    {
      name: 'redis_sets',
      url: args.redisSetsUrl ?? 'http://127.0.0.1:4201/search',
    },
    {
      name: 'redisearch',
      url: args.redisearchUrl ?? 'http://127.0.0.1:4202/search',
    },
    {
      name: 'openldap',
      url: args.ldapUrl ?? 'http://127.0.0.1:4203/search',
    },
  ];
}

async function validateForwardedTargetHeader(
  target: TargetConfig,
  limit: number,
  raceMode: boolean,
): Promise<void> {
  const validationSuite = suites[0];
  const validationUrl = new URL(target.url);
  validationUrl.searchParams.set('filter', validationSuite.filter);
  validationUrl.searchParams.set('limit', String(limit));
  if (raceMode) {
    validationUrl.searchParams.set('view', 'ids');
    validationUrl.searchParams.set('sort', 'none');
  }

  const response = await fetch(validationUrl.toString());
  const marker = response.headers.get('x-eldapo-core');

  // Drain response payload so keep-alive sockets are reusable before autocannon starts.
  await response.arrayBuffer();

  if (!response.ok) {
    throw new Error(
      `Forwarded target validation failed for ${target.name}: ${validationUrl.toString()} returned ${response.status}`,
    );
  }

  if (marker !== '1') {
    throw new Error(
      `Forwarded target validation failed for ${target.name}: expected x-eldapo-core=1, got ${marker ?? 'missing'}`,
    );
  }
}

async function runAutocannon(options: {
  url: string;
  duration: number;
  connections: number;
}): Promise<autocannon.Result> {
  return await new Promise((resolvePromise, rejectPromise) => {
    autocannon(
      {
        url: options.url,
        duration: options.duration,
        connections: options.connections,
      },
      (error, result) => {
        if (error || !result) {
          rejectPromise(error ?? new Error('autocannon failed'));
          return;
        }

        resolvePromise(result);
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

type ParsedArgs = {
  sqlUrl?: string;
  coreUrl?: string;
  v1ForwardedUrl?: string;
  redisSetsUrl?: string;
  redisearchUrl?: string;
  ldapUrl?: string;
  customTargets: TargetConfig[];
  outDir?: string;
  only?: string;
  targets?: string[];
  duration?: number;
  connections?: number;
  limit?: number;
  dataset?: string;
  scenario?: string;
  raceMode: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    customTargets: [],
    raceMode: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--sql-url=')) {
      parsed.sqlUrl = arg.slice('--sql-url='.length);
      continue;
    }

    if (arg.startsWith('--core-url=')) {
      parsed.coreUrl = arg.slice('--core-url='.length);
      continue;
    }

    if (arg.startsWith('--v1-forwarded-url=')) {
      parsed.v1ForwardedUrl = arg.slice('--v1-forwarded-url='.length);
      continue;
    }

    if (arg.startsWith('--redis-sets-url=')) {
      parsed.redisSetsUrl = arg.slice('--redis-sets-url='.length);
      continue;
    }

    if (arg.startsWith('--redisearch-url=')) {
      parsed.redisearchUrl = arg.slice('--redisearch-url='.length);
      continue;
    }

    if (arg.startsWith('--ldap-url=')) {
      parsed.ldapUrl = arg.slice('--ldap-url='.length);
      continue;
    }

    if (arg.startsWith('--target=')) {
      parsed.customTargets.push(parseTargetFlag(arg.slice('--target='.length)));
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length);
      continue;
    }

    if (arg.startsWith('--targets=')) {
      parsed.targets = parseTargetList(arg.slice('--targets='.length));
      continue;
    }

    // Backward compatible shim for existing invocations.
    if (arg.startsWith('--only=')) {
      parsed.only = arg.slice('--only='.length).trim();
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

    if (arg === '--race-mode') {
      parsed.raceMode = true;
    }
  }

  return parsed;
}

function parseTargetFlag(raw: string): TargetConfig {
  const separator = raw.indexOf(',');
  if (separator <= 0 || separator === raw.length - 1) {
    throw new Error(`Invalid --target value "${raw}". Expected format: --target=name,url`);
  }

  const name = raw.slice(0, separator).trim();
  const url = raw.slice(separator + 1).trim();

  if (!name || !url) {
    throw new Error(`Invalid --target value "${raw}". Expected non-empty name and url.`);
  }

  return { name, url };
}

function parseTargetList(raw: string): string[] {
  return [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
