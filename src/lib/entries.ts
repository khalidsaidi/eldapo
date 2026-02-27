import type { EntryAttrs, EntryRecord } from '@/lib/types';

type RawEntryRow = {
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

export type SearchCursor = {
  updated_at: string;
  id: string;
};

export function normalizeAttrs(value: unknown): EntryAttrs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const output: EntryAttrs = {};

  for (const [key, rawAttr] of Object.entries(value)) {
    if (Array.isArray(rawAttr)) {
      output[key] = rawAttr.map((item) => String(item));
      continue;
    }

    if (rawAttr === null || rawAttr === undefined) {
      output[key] = [];
      continue;
    }

    output[key] = [String(rawAttr)];
  }

  return output;
}

export function normalizeEntryRow(row: RawEntryRow): EntryRecord {
  return {
    id: row.id,
    rev: Number(row.rev),
    type: row.type,
    namespace: row.namespace,
    name: row.name,
    description: row.description ?? '',
    version: row.version ?? null,
    attrs: normalizeAttrs(row.attrs),
    manifest: row.manifest ?? null,
    meta: row.meta ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(rawCursor: string): SearchCursor {
  const parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')) as unknown;

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as SearchCursor).updated_at !== 'string' ||
    typeof (parsed as SearchCursor).id !== 'string'
  ) {
    throw new Error('invalid cursor payload');
  }

  return {
    updated_at: (parsed as SearchCursor).updated_at,
    id: (parsed as SearchCursor).id,
  };
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    return String(value);
  }

  return asDate.toISOString();
}
