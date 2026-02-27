import { describe, expect, it } from 'vitest';

import { normalizeEntryRow } from '@/lib/entries';

describe('normalizeEntryRow', () => {
  it('parses JSON strings returned by some postgres configurations', () => {
    const row = normalizeEntryRow({
      id: 'skill:acme:pdf-summarize',
      rev: 2,
      type: 'skill',
      namespace: 'acme',
      name: 'PDF Summarize',
      description: 'Summarize PDFs',
      version: '1.1.0',
      attrs: '{"capability":["summarize"],"visibility":["public"]}',
      manifest: '{"endpoint":"https://example.dev"}',
      meta: '{"source":"test"}',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });

    expect(row.attrs).toEqual({
      capability: ['summarize'],
      visibility: ['public'],
    });
    expect(row.manifest).toEqual({ endpoint: 'https://example.dev' });
    expect(row.meta).toEqual({ source: 'test' });
  });
});
