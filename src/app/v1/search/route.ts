import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { canSee, parseRequester } from '@/lib/access';
import { getDb } from '@/lib/db';
import { decodeCursor, encodeCursor, normalizeEntryRow, type SearchCursor } from '@/lib/entries';
import { AppError, errorResponse } from '@/lib/errors';
import { compileToSql } from '@/lib/filter/compileToSql';
import { parseFilter } from '@/lib/filter/parser';
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

const searchQuerySchema = z.object({
  filter: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  cursor: z.string().optional(),
  sort: z.enum(['updated_at_desc']).default('updated_at_desc'),
  view: z.enum(['card', 'full']).default('card'),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const parsedQuery = searchQuerySchema.parse({
      filter: emptyToUndefined(request.nextUrl.searchParams.get('filter')),
      q: emptyToUndefined(request.nextUrl.searchParams.get('q')),
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      cursor: emptyToUndefined(request.nextUrl.searchParams.get('cursor')),
      sort: emptyToUndefined(request.nextUrl.searchParams.get('sort')),
      view: emptyToUndefined(request.nextUrl.searchParams.get('view')),
    });

    let baseFilterSql = 'TRUE';
    let baseFilterParams: Array<string | number> = [];

    if (parsedQuery.filter) {
      const ast = parseFilter(parsedQuery.filter);
      const compiled = compileToSql(ast);
      baseFilterSql = compiled.sql;
      baseFilterParams = compiled.params;
    }

    let scanCursor: SearchCursor | null = null;
    if (parsedQuery.cursor) {
      try {
        scanCursor = decodeCursor(parsedQuery.cursor);
      } catch {
        throw new AppError('invalid_request', 'Invalid cursor.');
      }
    }

    const requester = parseRequester(request);
    const fetchWindow = Math.min(Math.max(parsedQuery.limit * 2, 20), 400);

    const visibleRows: Row[] = [];
    let nextCursor: string | null = null;

    while (visibleRows.length < parsedQuery.limit) {
      const whereClauses: string[] = [baseFilterSql];
      const params: Array<string | number> = [...baseFilterParams];

      if (parsedQuery.q) {
        params.push(`%${parsedQuery.q}%`);
        const patternRef = `$${params.length}`;
        whereClauses.push(`(name ILIKE ${patternRef} OR description ILIKE ${patternRef})`);
      }

      if (scanCursor) {
        params.push(scanCursor.updated_at);
        const tsRef = `$${params.length}`;
        params.push(scanCursor.id);
        const idRef = `$${params.length}`;
        whereClauses.push(`((updated_at, id) < (${tsRef}::timestamptz, ${idRef}::text))`);
      }

      params.push(fetchWindow);
      const limitRef = `$${params.length}`;

      const sqlText = `
        WITH latest AS (
          SELECT DISTINCT ON (id)
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
          ORDER BY id, rev DESC
        )
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
        FROM latest
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${limitRef}
      `;

      const rows = (await getDb().unsafe(sqlText, params)) as Row[];

      if (rows.length === 0) {
        break;
      }

      let hitPageLimit = false;

      for (const row of rows) {
        const normalized = normalizeEntryRow(row);
        scanCursor = {
          updated_at: normalized.updated_at,
          id: normalized.id,
        };

        if (canSee(normalized, requester)) {
          visibleRows.push(row);
          if (visibleRows.length >= parsedQuery.limit) {
            nextCursor = encodeCursor(scanCursor);
            hitPageLimit = true;
            break;
          }
        }
      }

      if (hitPageLimit) {
        break;
      }

      if (rows.length < fetchWindow) {
        break;
      }
    }

    const items = visibleRows.map((row) => {
      const normalized = normalizeEntryRow(row);
      return parsedQuery.view === 'full' ? toFull(normalized) : toCard(normalized);
    });

    return NextResponse.json({ items, next_cursor: nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}
