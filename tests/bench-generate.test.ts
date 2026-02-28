import { describe, expect, it } from 'vitest';

import { generateEntry } from '../scripts/bench/generate';

describe('bench generator distributions', () => {
  it('covers expected categorical values in the first 10k entries', () => {
    const tagValues = new Set<string>();
    const capabilityValues = new Set<string>();
    const envValues = new Set<string>();
    const visibilityValues = new Set<string>();

    for (let index = 0; index < 10_000; index += 1) {
      const entry = generateEntry(index);
      tagValues.add(entry.attrs.tag[0]);
      capabilityValues.add(entry.attrs.capability[0]);
      envValues.add(entry.attrs.env[0]);
      visibilityValues.add(entry.attrs.visibility[0]);
    }

    expect(tagValues.size).toBe(6);
    expect(capabilityValues).toEqual(
      new Set(['summarize', 'extract', 'classify', 'retrieve', 'embed', 'rerank']),
    );
    expect(envValues.size).toBe(3);
    expect(visibilityValues).toEqual(new Set(['public', 'internal', 'restricted']));
  });
});
