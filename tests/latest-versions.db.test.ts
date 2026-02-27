import 'dotenv/config';

import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const shouldRun = process.env.ELDAPO_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);

const describeDb = shouldRun ? describe : describe.skip;

describeDb('entries_latest consistency', () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('keeps newest revision in entries_latest and full history in entries', async () => {
    const id = 'skill:acme:pdf-summarize';

    const latestRows = await sql<{ rev: number }[]>`
      SELECT rev
      FROM entries_latest
      WHERE id = ${id}
      LIMIT 1
    `;

    expect(latestRows).toHaveLength(1);
    expect(Number(latestRows[0].rev)).toBe(2);

    const versionRows = await sql<{ rev: number }[]>`
      SELECT rev
      FROM entries
      WHERE id = ${id}
      ORDER BY rev DESC
    `;

    expect(versionRows.map((row) => Number(row.rev))).toEqual([2, 1]);
  });
});
