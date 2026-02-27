import { NextRequest, NextResponse } from 'next/server';

import { canSee, parseRequester } from '@/lib/access';
import { getDb } from '@/lib/db';
import { normalizeEntryRow } from '@/lib/entries';
import { AppError, errorResponse } from '@/lib/errors';

type EntryRow = {
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

type VersionRow = {
  rev: number;
  version: string | null;
  updated_at: Date | string;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const latestRows = (await getDb().unsafe(
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
    )) as EntryRow[];

    if (latestRows.length === 0) {
      throw new AppError('not_found', 'Entry not found.');
    }

    const requester = parseRequester(request);
    const latestEntry = normalizeEntryRow(latestRows[0]);

    if (!canSee(latestEntry, requester)) {
      throw new AppError('not_found', 'Entry not found.');
    }

    const versions = (await getDb().unsafe(
      `
        SELECT rev, version, updated_at
        FROM entries
        WHERE id = $1
        ORDER BY rev DESC
      `,
      [id],
    )) as VersionRow[];

    return NextResponse.json({
      id,
      versions: versions.map((version) => ({
        rev: Number(version.rev),
        version: version.version,
        updated_at: version.updated_at instanceof Date ? version.updated_at.toISOString() : new Date(version.updated_at).toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
