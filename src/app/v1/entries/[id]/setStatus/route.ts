import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { normalizeAttrs } from '@/lib/entries';
import { AppError, errorResponse } from '@/lib/errors';
import { readJsonBody } from '@/lib/http';
import { assertWriteAccess } from '@/lib/writes';

const setStatusSchema = z.object({
  status: z.enum(['active', 'deprecated', 'disabled']),
  reason: z.string().min(1).optional(),
});

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
};

type UpdatedRow = {
  id: string;
  rev: number;
  updated_at: Date | string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    assertWriteAccess(request);

    const { id } = await context.params;
    const payload = await readJsonBody(request);
    const parsedBody = setStatusSchema.parse(payload);

    const db = getDb();
    const updated = await db.begin(async (tx) => {
      const latestRows = (await tx.unsafe(
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
            meta
          FROM entries
          WHERE id = $1
          ORDER BY rev DESC
          LIMIT 1
        `,
        [id],
      )) as EntryRow[];

      const latest = latestRows[0];
      if (!latest) {
        throw new AppError('not_found', 'Entry not found.');
      }

      const nextRev = Number(latest.rev) + 1;
      const nextAttrs = normalizeAttrs(latest.attrs);
      nextAttrs.status = [parsedBody.status];

      const nextMeta =
        latest.meta && typeof latest.meta === 'object' && !Array.isArray(latest.meta)
          ? { ...(latest.meta as Record<string, unknown>) }
          : {};

      if (parsedBody.reason) {
        nextMeta.reason = parsedBody.reason;
      }

      const inserted = (await tx.unsafe(
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
          RETURNING id, rev, updated_at
        `,
        [
          latest.id,
          nextRev,
          latest.type,
          latest.namespace,
          latest.name,
          latest.description,
          latest.version,
          JSON.stringify(nextAttrs),
          latest.manifest === null ? null : JSON.stringify(latest.manifest),
          JSON.stringify(nextMeta),
        ],
      )) as UpdatedRow[];

      return inserted[0] ?? null;
    });

    if (!updated) {
      throw new AppError('internal', 'Failed to update status.');
    }

    return NextResponse.json({
      id: updated.id,
      rev: updated.rev,
      status: parsedBody.status,
      updated_at:
        updated.updated_at instanceof Date
          ? updated.updated_at.toISOString()
          : new Date(String(updated.updated_at)).toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
