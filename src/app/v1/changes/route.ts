import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { canSee, parseRequester } from '@/lib/access';
import { getDb } from '@/lib/db';
import { normalizeAttrs } from '@/lib/entries';
import { errorResponse } from '@/lib/errors';
import { emptyToUndefined } from '@/lib/http';

type ChangeRow = {
  seq: number | string;
  id: string;
  rev: number | string;
  change_type: string;
  changed_at: Date | string;
  attrs: unknown;
};

const querySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const query = querySchema.parse({
      since: emptyToUndefined(request.nextUrl.searchParams.get('since')),
      limit: emptyToUndefined(request.nextUrl.searchParams.get('limit')),
    });

    const requester = parseRequester(request);
    const scanWindow = Math.min(Math.max(query.limit * 5, 200), 5000);
    let scannedSince = query.since;
    const events: Array<{
      seq: number;
      id: string;
      rev: number;
      change_type: string;
      changed_at: string;
    }> = [];

    while (events.length < query.limit) {
      const rows = (await getDb().unsafe(
        `
          SELECT c.seq, c.id, c.rev, c.change_type, c.changed_at, e.attrs
          FROM changes c
          JOIN entries e ON e.id = c.id AND e.rev = c.rev
          WHERE c.seq > $1
          ORDER BY c.seq ASC
          LIMIT $2
        `,
        [scannedSince, scanWindow],
      )) as ChangeRow[];

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const seq = Number(row.seq);
        scannedSince = seq;

        const attrs = normalizeAttrs(row.attrs);
        if (!canSee({ attrs }, requester)) {
          continue;
        }

        events.push({
          seq,
          id: row.id,
          rev: Number(row.rev),
          change_type: row.change_type,
          changed_at:
            row.changed_at instanceof Date ? row.changed_at.toISOString() : new Date(row.changed_at).toISOString(),
        });

        if (events.length >= query.limit) {
          break;
        }
      }

      if (rows.length < scanWindow) {
        break;
      }
    }

    return NextResponse.json({
      next_since: scannedSince,
      events,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
