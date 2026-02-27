import { describe, expect, it } from 'vitest';

import { toCard, toFull } from '@/lib/view';

const sampleEntry = {
  id: 'skill:acme:pdf-summarize',
  rev: 2,
  type: 'skill',
  namespace: 'acme',
  name: 'PDF Summarize',
  description: 'Summarize PDFs',
  version: '1.1.0',
  attrs: {
    tag: ['pdf'],
    capability: ['summarize'],
    status: ['active'],
    visibility: ['public'],
    endpoint: ['https://example.dev/pdf'],
    owner: ['acme-ai'],
    allowed_group: ['finance'],
    custom: ['kept-only-in-full'],
  },
  manifest: { endpoint: 'https://example.dev/pdf' },
  meta: { source: 'test' },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('view projection', () => {
  it('creates card projections with limited attrs', () => {
    const card = toCard(sampleEntry);

    expect(card).toEqual({
      id: 'skill:acme:pdf-summarize',
      rev: 2,
      type: 'skill',
      namespace: 'acme',
      name: 'PDF Summarize',
      description: 'Summarize PDFs',
      version: '1.1.0',
      attrs: {
        tag: ['pdf'],
        capability: ['summarize'],
        status: ['active'],
        visibility: ['public'],
        endpoint: ['https://example.dev/pdf'],
        owner: ['acme-ai'],
      },
    });
  });

  it('returns full projection as stored', () => {
    expect(toFull(sampleEntry)).toEqual(sampleEntry);
  });
});
