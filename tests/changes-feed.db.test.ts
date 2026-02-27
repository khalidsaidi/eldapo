import 'dotenv/config';

import postgres from 'postgres';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { GET as getChanges } from '@/app/v1/changes/route';

const shouldRun = process.env.ELDAPO_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);

const describeDb = shouldRun ? describe : describe.skip;
const originalTrustedHeaders = process.env.ELDAPPO_TRUSTED_HEADERS;

describeDb('changes feed', () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  afterEach(() => {
    process.env.ELDAPPO_TRUSTED_HEADERS = originalTrustedHeaders;
  });

  it('returns ordered events after the since cursor', async () => {
    const id = `skill:test:changes-${Date.now()}`;

    await sql.unsafe(
      `
        INSERT INTO entries (
          id,
          rev,
          type,
          namespace,
          name,
          description,
          version,
          attrs,
          manifest,
          meta
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9::jsonb,
          $10::jsonb
        )
        ON CONFLICT (id, rev) DO NOTHING
      `,
      [
        id,
        1,
        'skill',
        'test',
        'Changes Test Skill',
        'Synthetic test entry for changes feed',
        '0.0.1',
        JSON.stringify({ visibility: ['public'], capability: ['summarize'] }),
        JSON.stringify({}),
        JSON.stringify({ source: 'test' }),
      ],
    );

    const inserted = await sql<{ seq: number | string }[]>`
      INSERT INTO changes (id, rev, change_type)
      VALUES (${id}, ${1}, ${'publish'})
      RETURNING seq
    `;

    const insertedSeq = Number(inserted[0].seq);
    const since = insertedSeq - 1;
    const request = new NextRequest(`http://localhost/v1/changes?since=${since}&limit=10`);
    const response = await getChanges(request);
    const payload = (await response.json()) as {
      next_since: number;
      events: Array<{ seq: number; id: string; rev: number; change_type: string }>;
    };

    expect(payload.events.length).toBeGreaterThan(0);
    expect(payload.events.some((event) => event.id === id && event.change_type === 'publish')).toBe(true);
    expect(payload.next_since).toBeGreaterThanOrEqual(insertedSeq);
  });

  it('hides restricted changes from anonymous requesters while advancing next_since', async () => {
    process.env.ELDAPPO_TRUSTED_HEADERS = 'false';

    const inserted = await sql<{ seq: number | string }[]>`
      INSERT INTO changes (id, rev, change_type)
      VALUES (${'rag:acme:sec-filings'}, ${1}, ${'publish'})
      RETURNING seq
    `;
    const insertedSeq = Number(inserted[0].seq);

    const request = new NextRequest(`http://localhost/v1/changes?since=${insertedSeq - 1}&limit=10`);
    const response = await getChanges(request);
    const payload = (await response.json()) as {
      next_since: number;
      events: Array<{ seq: number; id: string; rev: number; change_type: string }>;
    };

    expect(payload.events.some((event) => event.seq === insertedSeq)).toBe(false);
    expect(payload.next_since).toBeGreaterThanOrEqual(insertedSeq);
  });
});
