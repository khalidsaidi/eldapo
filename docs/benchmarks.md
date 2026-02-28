# eldapo Benchmarks

## Official SQL vs Core Report (2026-02-28)

### Run Metadata

- Window: `2026-02-27T21:40:29.961Z` to `2026-02-28T02:16:00.927Z`
- Scenario label: `official-sql-core-fixed`
- Commit SHA: `61c1af6666aa93ae88f4ff1ac0087e0255b016b1`
- OS: `Linux 6.6.87.2-microsoft-standard-WSL2 x86_64 GNU/Linux`
- CPU: `AMD Ryzen 7 3800X 8-Core Processor` (16 vCPUs exposed)
- RAM: `16337080 kB` (`15.58 GiB`)
- Node.js: `v20.20.0`
- pnpm: `9.15.3`
- Postgres baseline: `postgres:16` via Docker

### Methodology

- Dataset generator: `scripts/bench/generate.ts`
- Dataset sizes: `10,000`, `100,000`, `1,000,000`
- Deterministic generator fix: tag selection uses `pickOne(index * 5, tags)` so all six tags are represented (`gcd(5, 6) = 1`)
- Per dataset:
  1. `pnpm bench:load --file=.ai/bench/dataset-<size>.jsonl --truncate`
  2. Start `eldapo-core` against the same Postgres and wait for `/core/health`
  3. Capture core stats: `curl http://127.0.0.1:4100/core/stats > .ai/bench/core-stats-<size>.json`
  4. Run `pnpm bench:run --targets=sql,core --duration=20 --connections=50 --limit=20 --dataset=<size> --scenario=official-sql-core-fixed` five times
- Aggregation rule: discard run 1 (warmup), report median of runs 2-5

### Dataset + Query Notes

- Synthetic rows are generated with fixed deterministic distributions for `type`, `capability`, `tag`, `env`, `status`, and `visibility`.
- `attrs.endpoint` is present in benchmark-generated rows.
- Restricted rows include `attrs.allowed_group`.
- Query suites (exact filters from `scripts/bench/run.ts`):
  - `skill_summarize_prod`: `(&(type=skill)(capability=summarize)(env=prod))` (selective multi-clause conjunction)
  - `rag_finance_active`: `(&(type=rag)(capability=retrieve)(tag=finance)(status=active))` (selective multi-clause conjunction)
  - `tag_support`: `(tag=support)` (broad single-attribute equality)
  - `endpoint_presence`: `(endpoint=*)` (very broad presence query)
  - `tag_never`: `(tag=__never__)` (zero-hit control query)

### Core Stats Snapshots

| dataset | docs | eqTokens | presenceTokens | postingsCardinality | memoryApprox | buildMs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10k | 10,005 | 30,059 | 15 | 261,119 | 1,084,496 | 306.95 |
| 100k | 100,005 | 300,059 | 15 | 2,610,119 | 10,840,496 | 2,156.86 |
| 1M | 1,000,005 | 3,000,059 | 15 | 26,100,119 | 108,400,496 | 48,278.03 |

### Aggregated Results (Median of Runs 2-5)

#### Dataset 10k

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| core | endpoint_presence | 11.00 | 16.50 | 22.00 | 4107.8 |
| core | rag_finance_active | 14.00 | 21.50 | 28.00 | 3311.3 |
| core | skill_summarize_prod | 39.50 | 59.50 | 73.00 | 1173.1 |
| core | tag_never | 6.00 | 10.00 | 12.00 | 7467.9 |
| core | tag_support | 32.50 | 48.50 | 67.00 | 1427.8 |
| sql | endpoint_presence | 98.00 | 132.0 | 147.0 | 489.9 |
| sql | rag_finance_active | 73.50 | 107.0 | 115.5 | 648.5 |
| sql | skill_summarize_prod | 73.00 | 113.0 | 127.0 | 640.4 |
| sql | tag_never | 76.00 | 114.5 | 145.5 | 618.2 |
| sql | tag_support | 67.50 | 99.50 | 110.5 | 701.2 |

#### Dataset 100k

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| core | endpoint_presence | 14.50 | 28.00 | 34.50 | 3061.7 |
| core | rag_finance_active | 120.5 | 248.0 | 298.5 | 362.6 |
| core | skill_summarize_prod | 27.50 | 40.50 | 53.50 | 1733.0 |
| core | tag_never | 6.00 | 12.50 | 14.50 | 6791.1 |
| core | tag_support | 15.00 | 25.50 | 30.50 | 2995.4 |
| sql | endpoint_presence | 117.0 | 218.5 | 244.5 | 373.8 |
| sql | rag_finance_active | 80.00 | 137.5 | 154.0 | 573.3 |
| sql | skill_summarize_prod | 72.00 | 138.5 | 167.5 | 632.5 |
| sql | tag_never | 90.50 | 171.0 | 184.0 | 506.8 |
| sql | tag_support | 81.00 | 158.0 | 180.5 | 549.0 |

#### Dataset 1M

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| core | endpoint_presence | 56.50 | 76.00 | 102.0 | 844.8 |
| core | rag_finance_active | 65.00 | 95.00 | 119.0 | 716.7 |
| core | skill_summarize_prod | 153.0 | 202.0 | 218.5 | 308.9 |
| core | tag_never | 7.50 | 18.00 | 20.50 | 5741.8 |
| core | tag_support | 55.00 | 79.00 | 108.0 | 857.5 |
| sql | endpoint_presence | 107.0 | 153.0 | 171.5 | 455.2 |
| sql | rag_finance_active | 78.50 | 112.0 | 124.5 | 619.0 |
| sql | skill_summarize_prod | 82.50 | 141.5 | 168.5 | 565.8 |
| sql | tag_never | 82.50 | 116.5 | 126.0 | 576.1 |
| sql | tag_support | 77.50 | 112.0 | 123.5 | 619.1 |

### Scoped Claim

- On non-zero-hit suites in this published run, `eldapo-core` is up to `8.4x` faster than the Postgres `jsonb + GIN` baseline (10k `endpoint_presence`, by req/s).
- Including the zero-hit control (`tag_never`), peak observed speedup is `12.1x`.
- At 1M scale, `eldapo-core` is faster on `endpoint_presence`, `rag_finance_active`, and `tag_support`, but slower on `skill_summarize_prod` in this configuration.
- Claim scope is limited to this dataset generator, suite, hardware, and command settings.

### Competitor Race API Note

- Competitor race shims (`redis_sets`, `redisearch`, `openldap`) use an IDs-only contract:
  - `GET /search?filter=...&limit=...`
  - response: `{ "ids": ["..."], "count": <number> }`
- This normalizes payload size when comparing filter engines.

### Reproduce

Bring up dependencies and app:

```bash
pnpm race:up
DATABASE_URL=postgres://eldapo:eldapo@127.0.0.1:5432/eldapo pnpm db:migrate
DATABASE_URL=postgres://eldapo:eldapo@127.0.0.1:5432/eldapo pnpm db:seed
pnpm build
DATABASE_URL=postgres://eldapo:eldapo@127.0.0.1:5432/eldapo pnpm start
```

Run official SQL/Core sweep:

```bash
for size in 10000 100000 1000000; do
  DATABASE_URL=postgres://eldapo:eldapo@127.0.0.1:5432/eldapo pnpm bench:load --file=.ai/bench/dataset-${size}.jsonl --truncate

  DATABASE_URL=postgres://eldapo:eldapo@127.0.0.1:5432/eldapo ./node_modules/.bin/tsx src/daemon/server.ts &
  CORE_PID=$!

  until curl -sf http://127.0.0.1:4100/core/health >/dev/null; do sleep 1; done
  curl -sS http://127.0.0.1:4100/core/stats > .ai/bench/core-stats-${size}.json

  for run in 1 2 3 4 5; do
    pnpm bench:run --targets=sql,core --duration=20 --connections=50 --limit=20 --dataset=${size} --scenario=official-sql-core-fixed
  done

  kill "$CORE_PID"
done

pnpm bench:report --scenario=official-sql-core-fixed
```

Validate forwarded `/v1` runs are actually core-backed:

```bash
ELDAPPO_USE_CORE=true ELDAPPO_CORE_URL=http://127.0.0.1:4100 \
  pnpm bench:run --targets=v1_forwarded --duration=20 --connections=50 --limit=20
```

Notes:
- Benchmark artifacts remain in `.ai/bench/` and are intentionally untracked.
- Competitor loaders/servers are available via `race:load:*` and `race:serve:*` scripts.
