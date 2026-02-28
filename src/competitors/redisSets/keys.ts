export type RedisSetScope = 'top' | 'attr';

export const BENCH_PREFIX = 'bench';
export const UNIVERSE_KEY = `${BENCH_PREFIX}:universe`;

export function eqKey(scope: RedisSetScope, key: string, value: string): string {
  return `${BENCH_PREFIX}:eq:${scope}:${encodeComponent(key)}:${encodeComponent(value)}`;
}

export function presenceKey(scope: RedisSetScope, key: string): string {
  return `${BENCH_PREFIX}:pr:${scope}:${encodeComponent(key)}`;
}

export function tempKey(requestId: string, index: number): string {
  return `${BENCH_PREFIX}:tmp:${requestId}:${index}`;
}

function encodeComponent(value: string): string {
  return encodeURIComponent(value);
}
