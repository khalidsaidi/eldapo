import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { canSee, parseRequester } from '@/lib/access';
import { getDb } from '@/lib/db';
import { normalizeEntryRow } from '@/lib/entries';
import { AppError, errorResponse } from '@/lib/errors';
import { emptyToUndefined } from '@/lib/http';
import { toCard, toFull } from '@/lib/view';

type Row = {
  id: string;
  rev: number;
  type: string;
  namespace: string;
  name: string;
  description: string;
  version: string | null;
  attrs: unknown;
  manifest: unknown;
  meta: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

const querySchema = z.object({
  rev: z.coerce.number().int().min(1).optional(),
  view: z.enum(['card', 'full']).default('full'),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const parsedQuery = querySchema.parse({
      rev: emptyToUndefined(request.nextUrl.searchParams.get('rev')),
      view: emptyToUndefined(request.nextUrl.searchParams.get('view')),
    });

    let rows: Row[] = [];
    if (parsedQuery.rev !== undefined) {
      rows = (await getDb().unsafe(
        `
          SELECT
            id,
            rev,
            type,
            namespace,
            name,
            description,
            version,
            attrs,
            manifest,
            meta,
            created_at,
            updated_at
          FROM entries
          WHERE id = $1 AND rev = $2
          LIMIT 1
        `,
        [id, parsedQuery.rev],
      )) as Row[];
    } else {
      rows = (await getDb().unsafe(
        `
          SELECT
            id,
            rev,
            type,
            namespace,
            name,
            description,
            version,
            attrs,
            manifest,
            meta,
            created_at,
            updated_at
          FROM entries
          WHERE id = $1
          ORDER BY rev DESC
          LIMIT 1
        `,
        [id],
      )) as Row[];
    }

    if (rows.length === 0) {
      throw new AppError('not_found', 'Entry not found.');
    }

    const requester = parseRequester(request);
    const entry = normalizeEntryRow(rows[0]);

    if (!canSee(entry, requester)) {
      throw new AppError('not_found', 'Entry not found.');
    }

    return NextResponse.json({
      item: parsedQuery.view === 'card' ? toCard(entry) : toFull(entry),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
