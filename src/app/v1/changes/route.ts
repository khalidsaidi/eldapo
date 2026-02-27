import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/errors';
import { emptyToUndefined } from '@/lib/http';

type ChangeRow = {
  seq: number;
  id: string;
  rev: number;
  change_type: string;
  changed_at: Date | string;
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

    const rows = (await getDb().unsafe(
      `
        SELECT seq, id, rev, change_type, changed_at
        FROM changes
        WHERE seq > $1
        ORDER BY seq ASC
        LIMIT $2
      `,
      [query.since, query.limit],
    )) as ChangeRow[];

    const events = rows.map((row) => ({
      seq: Number(row.seq),
      id: row.id,
      rev: Number(row.rev),
      change_type: row.change_type,
      changed_at:
        row.changed_at instanceof Date ? row.changed_at.toISOString() : new Date(row.changed_at).toISOString(),
    }));

    const nextSince = events.length > 0 ? events[events.length - 1].seq : query.since;

    return NextResponse.json({
      next_since: nextSince,
      events,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
