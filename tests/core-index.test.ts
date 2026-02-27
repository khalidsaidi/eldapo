import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCoreIndex } from '@/core/index';
import { parseRequester } from '@/lib/access';
import { decodeCursor } from '@/lib/entries';
import { parseFilter } from '@/lib/filter/parser';
import type { EntryRecord } from '@/lib/types';

const originalTrustedHeaders = process.env.ELDAPPO_TRUSTED_HEADERS;

afterEach(() => {
  process.env.ELDAPPO_TRUSTED_HEADERS = originalTrustedHeaders;
});

describe('InMemoryCoreIndex', () => {
  it('evaluates LDAP filters for top-level and attrs keys', () => {
    const index = new InMemoryCoreIndex();

    index.buildFromSnapshot([
      makeEntry({
        id: 'skill:acme:pdf-summarize',
        type: 'skill',
        attrs: { capability: ['summarize'], visibility: ['public'] },
      }),
      makeEntry({
        id: 'rag:acme:sec-filings',
        type: 'rag',
        attrs: { capability: ['retrieve'], visibility: ['public'] },
      }),
    ]);

    const requester = parseRequester(new Request('http://localhost'));
    const result = index.search(parseFilter('(&(type=skill)(capability=summarize))'), {
      limit: 20,
      cursor: null,
    }, requester);

    expect(result.items.map((item) => item.entry.id)).toEqual(['skill:acme:pdf-summarize']);
  });

  it('enforces visibility with requester groups', () => {
    process.env.ELDAPPO_TRUSTED_HEADERS = 'true';

    const index = new InMemoryCoreIndex();
    index.buildFromSnapshot([
      makeEntry({
        id: 'rag:acme:sec-filings',
        type: 'rag',
        attrs: {
          visibility: ['restricted'],
          allowed_group: ['finance'],
          capability: ['retrieve'],
        },
      }),
    ]);

    const filter = parseFilter('(id=rag:acme:sec-filings)');

    const anonymous = parseRequester(new Request('http://localhost'));
    const authorized = parseRequester(
      new Request('http://localhost', {
        headers: {
          authorization: 'Bearer test',
          'x-eldapo-sub': 'user-1',
          'x-eldapo-groups': 'finance,ops',
        },
      }),
    );

    expect(
      index.search(filter, { limit: 20, cursor: null }, anonymous).items,
    ).toHaveLength(0);

    expect(
      index.search(filter, { limit: 20, cursor: null }, authorized).items,
    ).toHaveLength(1);
  });

  it('supports cursor pagination ordered by updated_at desc then id desc', () => {
    const index = new InMemoryCoreIndex();

    index.buildFromSnapshot([
      makeEntry({
        id: 'skill:acme:older',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
      makeEntry({
        id: 'skill:acme:newer',
        updated_at: '2026-01-02T00:00:00.000Z',
      }),
    ]);

    const requester = parseRequester(new Request('http://localhost'));

    const page1 = index.search(null, { limit: 1, cursor: null }, requester);
    expect(page1.items.map((item) => item.entry.id)).toEqual(['skill:acme:newer']);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = index.search(
      null,
      { limit: 1, cursor: decodeCursor(page1.next_cursor as string) },
      requester,
    );

    expect(page2.items.map((item) => item.entry.id)).toEqual(['skill:acme:older']);
  });

  it('applies newer change revisions and keeps read fast', () => {
    const index = new InMemoryCoreIndex();

    index.buildFromSnapshot([
      makeEntry({ id: 'skill:acme:status', rev: 1, attrs: { status: ['active'], visibility: ['public'] } }),
    ]);

    index.applyChange(
      { id: 'skill:acme:status', rev: 2 },
      makeEntry({
        id: 'skill:acme:status',
        rev: 2,
        updated_at: '2026-02-01T00:00:00.000Z',
        attrs: { status: ['deprecated'], visibility: ['public'] },
      }),
    );

    const requester = parseRequester(new Request('http://localhost'));
    const hit = index.read('skill:acme:status', requester);

    expect(hit?.entry.rev).toBe(2);
    expect(hit?.entry.attrs.status).toEqual(['deprecated']);
  });

  it('returns omitted count for forbidden entries in batchGet', () => {
    process.env.ELDAPPO_TRUSTED_HEADERS = 'true';

    const index = new InMemoryCoreIndex();
    index.buildFromSnapshot([
      makeEntry({
        id: 'skill:acme:public',
        attrs: { visibility: ['public'] },
      }),
      makeEntry({
        id: 'skill:acme:restricted',
        attrs: { visibility: ['restricted'], allowed_group: ['eng'] },
      }),
    ]);

    const anonymous = parseRequester(new Request('http://localhost'));
    const result = index.batchGet(['skill:acme:public', 'skill:acme:restricted'], anonymous);

    expect(result.items.map((item) => item.entry.id)).toEqual(['skill:acme:public']);
    expect(result.omitted).toBe(1);
  });
});

function makeEntry(input: Partial<EntryRecord> & Pick<EntryRecord, 'id'>): EntryRecord {
  return {
    id: input.id,
    rev: input.rev ?? 1,
    type: input.type ?? 'skill',
    namespace: input.namespace ?? 'acme',
    name: input.name ?? input.id,
    description: input.description ?? 'test entry',
    version: input.version ?? '1.0.0',
    attrs: input.attrs ?? { visibility: ['public'] },
    manifest: input.manifest ?? null,
    meta: input.meta ?? null,
    created_at: input.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: input.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}
