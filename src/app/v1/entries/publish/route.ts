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
      const insertParams: unknown[] = [
        entry.id,
        nextRev,
        entry.type,
        entry.namespace,
        entry.name,
        entry.description,
        entry.version ?? null,
        normalizedAttrs,
        entry.manifest ?? null,
        entry.meta ?? null,
      ];

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
        insertParams as never[],
      )) as PublishedRow[];

      const inserted = insertedRows[0] ?? null;
      if (!inserted) {
        return null;
      }

      await tx.unsafe(
        `
          INSERT INTO entries_latest (
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
          FROM entries
          WHERE id = $1 AND rev = $2
          ON CONFLICT (id) DO UPDATE
          SET
            rev = EXCLUDED.rev,
            type = EXCLUDED.type,
            namespace = EXCLUDED.namespace,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            version = EXCLUDED.version,
            attrs = EXCLUDED.attrs,
            manifest = EXCLUDED.manifest,
            meta = EXCLUDED.meta,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
          WHERE entries_latest.rev <= EXCLUDED.rev
        `,
        [inserted.id, inserted.rev],
      );

      await tx.unsafe(`INSERT INTO changes (id, rev, change_type) VALUES ($1, $2, $3)`, [
        inserted.id,
        inserted.rev,
        'publish',
      ]);

      return inserted;
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
