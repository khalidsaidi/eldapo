import { describe, expect, it } from 'vitest';

import { FilterAstCache } from '@/daemon/filterCache';

describe('FilterAstCache', () => {
  it('returns the same AST object for repeated filter strings', () => {
    const cache = new FilterAstCache(4);

    const first = cache.getOrParse('(&(type=skill)(capability=summarize))');
    const second = cache.getOrParse('(&(type=skill)(capability=summarize))');

    expect(first).toBe(second);
    expect(cache.size()).toBe(1);
  });

  it('evicts least recently used entries when max size is exceeded', () => {
    const cache = new FilterAstCache(2);

    const a = cache.getOrParse('(type=skill)');
    cache.getOrParse('(type=rag)');
    cache.getOrParse('(type=mcp)');

    const aAgain = cache.getOrParse('(type=skill)');

    expect(aAgain).not.toBe(a);
    expect(cache.size()).toBe(2);
  });
});
