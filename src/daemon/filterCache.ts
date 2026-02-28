import type { FilterNode } from '@/lib/filter/ast';
import { parseFilter } from '@/lib/filter/parser';

const DEFAULT_FILTER_CACHE_SIZE = 256;

export class FilterAstCache {
  private readonly maxEntries: number;
  private readonly cache = new Map<string, FilterNode>();

  constructor(maxEntries = DEFAULT_FILTER_CACHE_SIZE) {
    const safeMax = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : DEFAULT_FILTER_CACHE_SIZE;
    this.maxEntries = safeMax;
  }

  getOrParse(filter: string): FilterNode {
    const cached = this.cache.get(filter);
    if (cached) {
      this.cache.delete(filter);
      this.cache.set(filter, cached);
      return cached;
    }

    const parsed = parseFilter(filter);
    this.cache.set(filter, parsed);

    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (typeof oldest === 'string') {
        this.cache.delete(oldest);
      }
    }

    return parsed;
  }

  size(): number {
    return this.cache.size;
  }
}
