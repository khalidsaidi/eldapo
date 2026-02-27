# eldapo Benchmarks

## Run Metadata

- Date window: 2026-02-27T05:51:31Z to 2026-02-27T07:08:08Z
- Code base used during run: `9b0e81aa90490f8a88c3f95cfab386cb4dfd392b` plus the benchmark harness updates committed alongside this report
- Machine:
  - OS: Ubuntu on WSL2 (`Linux 6.6.87.2-microsoft-standard-WSL2`)
  - CPU: 13th Gen Intel(R) Core(TM) i9-13900H (8 vCPU visible)
  - RAM: 23 GiB
- Runtime:
  - Node.js `v20.19.0`
  - pnpm `9.15.1`
  - Postgres `16.11` (Docker, `postgres:16`)

## Methodology

- Build mode: production (`pnpm build`, `pnpm start`), not `next dev`.
- Targets:
  - SQL baseline: `GET /v1/search` with `ELDAPPO_USE_CORE=false`
  - Core direct: `GET /core/search`
  - Forwarded (optional): `GET /v1/search` with `ELDAPPO_USE_CORE=true`
- Suites (same as `scripts/bench/run.ts`):
  - `(&(type=skill)(capability=summarize)(env=prod))`
  - `(&(type=rag)(capability=retrieve)(tag=finance)(status=active))`
  - `(tag=pdf)`
  - `(endpoint=*)`
- Load profile:
  - 5 runs per suite-target
  - first run discarded as warmup
  - report value = median of runs 2-5
  - `--duration=20` and `--connections=50`
- Datasets:
  - 10k: SQL vs core
  - 100k: SQL vs core + forwarded `/v1`
  - 1M: SQL vs core

## Core Index Stats

| dataset | docs | eqTokens | presenceTokens | buildMs | memoryApprox |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k | 10,005 | 30,057 | 15 | 124.16 | 1.08 MB |
| 100k | 100,005 | 300,057 | 15 | 1,788.77 | 10.84 MB |
| 1M | 1,000,005 | 3,000,057 | 15 | 32,953.87 | 108.40 MB |

## Results (Median of Runs 2-5)

### 10k — SQL vs Core

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| core | endpoint_presence | 4.50 | 9.00 | 10.50 | 9172.6 |
| core | rag_finance_active | 6.50 | 11.00 | 13.50 | 6588.5 |
| core | skill_summarize_prod | 6.00 | 11.00 | 12.00 | 7351.0 |
| core | tag_pdf | 9.00 | 12.50 | 17.00 | 5169.0 |
| sql | endpoint_presence | 80.00 | 103.0 | 112.5 | 611.1 |
| sql | rag_finance_active | 58.50 | 80.00 | 93.00 | 817.5 |
| sql | skill_summarize_prod | 58.50 | 79.50 | 87.00 | 824.0 |
| sql | tag_pdf | 57.00 | 81.50 | 95.00 | 838.0 |

### 100k — SQL vs Core

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| core | endpoint_presence | 5.00 | 9.00 | 11.50 | 8290.0 |
| core | rag_finance_active | 14.00 | 20.50 | 27.00 | 3331.5 |
| core | skill_summarize_prod | 16.50 | 25.50 | 32.50 | 2820.4 |
| core | tag_pdf | 59.50 | 76.00 | 118.0 | 810.0 |
| sql | endpoint_presence | 88.00 | 111.5 | 121.0 | 554.3 |
| sql | rag_finance_active | 64.50 | 89.50 | 98.00 | 750.8 |
| sql | skill_summarize_prod | 64.00 | 90.00 | 101.0 | 750.3 |
| sql | tag_pdf | 60.50 | 84.00 | 92.50 | 784.3 |

### 100k — `/v1/search` Forwarded to Core

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| /v1 forwarded | endpoint_presence | 89.50 | 108.0 | 114.0 | 547.9 |
| /v1 forwarded | rag_finance_active | 63.00 | 77.00 | 91.50 | 770.2 |
| /v1 forwarded | skill_summarize_prod | 61.50 | 81.50 | 93.00 | 785.2 |
| /v1 forwarded | tag_pdf | 60.00 | 73.50 | 88.00 | 812.9 |

### 1M — SQL vs Core

| target | suite | p50 (ms) | p95 (ms) | p99 (ms) | req/s |
| --- | --- | ---: | ---: | ---: | ---: |
| core | endpoint_presence | 6.00 | 15.00 | 16.00 | 6529.9 |
| core | rag_finance_active | 88.50 | 106.0 | 176.0 | 542.5 |
| core | skill_summarize_prod | 89.50 | 109.5 | 174.0 | 533.9 |
| core | tag_pdf | 433.5 | 762.0 | 3633.0 | 102.7 |
| sql | endpoint_presence | 85.00 | 103.5 | 110.0 | 576.2 |
| sql | rag_finance_active | 60.50 | 74.50 | 87.50 | 805.8 |
| sql | skill_summarize_prod | 59.00 | 81.00 | 89.00 | 816.7 |
| sql | tag_pdf | 59.50 | 74.50 | 87.50 | 819.8 |

## Interpretation (Scoped)

- On this machine, `eldapo-core` is materially faster than SQL for structured capability filters on 10k and 100k datasets, with p95 speedups from roughly **3.5x to 12x** depending on suite.
- At 1M scale in the current implementation, core does **not** dominate SQL for all equality filters (`skill_summarize_prod`, `rag_finance_active`, and especially `tag_pdf` regress).
- Core remains strong on the `endpoint=*` presence workload across all tested sizes.

## Reproduce

1. Generate/load datasets:
   - `pnpm bench:generate --sizes=10000,100000,1000000`
   - `pnpm bench:load --file=.ai/bench/dataset-<size>.jsonl --truncate --batch-size=1000`
2. Start services:
   - `pnpm build`
   - `ELDAPPO_USE_CORE=false pnpm start`
   - `pnpm core:dev`
3. Run benchmarks:
   - `pnpm bench:run --duration=20 --connections=50`
   - optional forwarded: `ELDAPPO_USE_CORE=true pnpm start` and `pnpm bench:run --only=sql --duration=20 --connections=50`
4. Aggregate:
   - `pnpm bench:report`

Raw benchmark JSON files are intentionally kept under `.ai/bench/` and are not committed.
