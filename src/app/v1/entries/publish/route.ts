import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { normalizeAttrs } from '@/lib/entries';
import { errorResponse } from '@/lib/errors';
import { readJsonBody } from '@/lib/http';
import { assertWriteAccess } from '@/lib/writes';

const attrsSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

const publishSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  namespace: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.string().nullable().optional(),
  attrs: attrsSchema.default({}),
  manifest: z.unknown().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

type NextRevRow = {
  next_rev: number;
};

type PublishedRow = {
  id: string;
  rev: number;
  updated_at: Date | string;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertWriteAccess(request);

    const payload = await readJsonBody(request);
    const entry = publishSchema.parse(payload);
    const normalizedAttrs = normalizeAttrs(entry.attrs);

    const db = getDb();
    const published = await db.begin(async (tx) => {
      const nextRevRows = (await tx.unsafe(
        `SELECT COALESCE(MAX(rev), 0) + 1 AS next_rev FROM entries WHERE id = $1`,
        [entry.id],
      )) as NextRevRow[];

      const nextRev = Number(nextRevRows[0]?.next_rev ?? 1);
      const insertedRows = (await tx.unsafe(
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
          entry.id,
          nextRev,
          entry.type,
          entry.namespace,
          entry.name,
          entry.description,
          entry.version ?? null,
          JSON.stringify(normalizedAttrs),
          entry.manifest === undefined ? null : JSON.stringify(entry.manifest),
          entry.meta === undefined ? null : JSON.stringify(entry.meta),
        ],
      )) as PublishedRow[];

      return insertedRows[0] ?? null;
    });

    if (!published) {
      throw new Error('Failed to publish entry.');
    }

    return NextResponse.json({
      id: published.id,
      rev: published.rev,
      updated_at:
        published.updated_at instanceof Date
          ? published.updated_at.toISOString()
          : new Date(String(published.updated_at)).toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
