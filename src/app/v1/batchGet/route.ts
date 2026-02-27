import { NextResponse } from 'next/server';
import { z } from 'zod';

import { canSee, parseRequester } from '@/lib/access';
import { forwardToCore } from '@/lib/coreProxy';
import { getDb } from '@/lib/db';
import { normalizeEntryRow } from '@/lib/entries';
import { errorResponse } from '@/lib/errors';
import { readJsonBody } from '@/lib/http';
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

const batchGetSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  view: z.enum(['card', 'full']).default('full'),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const bodyText = await request.clone().text();
    const coreResponse = await forwardToCore(request, {
      path: '/core/batchGet',
      method: 'POST',
      bodyText,
    });

    if (coreResponse) {
      return coreResponse;
    }

    const payload = await readJsonBody(request);
    const parsedBody = batchGetSchema.parse(payload);

    const rows = (await getDb().unsafe(
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
        FROM entries_latest
        WHERE id = ANY($1::text[])
      `,
      [parsedBody.ids],
    )) as Row[];

    const requester = parseRequester(request);
    const byId = new Map(rows.map((row) => [row.id, normalizeEntryRow(row)]));

    const items: Array<ReturnType<typeof toCard> | ReturnType<typeof toFull>> = [];
    let omitted = 0;

    for (const id of parsedBody.ids) {
      const entry = byId.get(id);
      if (!entry) {
        continue;
      }

      if (!canSee(entry, requester)) {
        omitted += 1;
        continue;
      }

      items.push(parsedBody.view === 'card' ? toCard(entry) : toFull(entry));
    }

    return NextResponse.json({ items, omitted });
  } catch (error) {
    return errorResponse(error);
  }
}
