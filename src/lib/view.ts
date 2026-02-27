import type { CardEntry, EntryRecord } from '@/lib/types';

const CARD_ATTR_KEYS = [
  'tag',
  'capability',
  'env',
  'status',
  'visibility',
  'endpoint',
  'auth',
  'owner',
] as const;

export function toCard(entry: EntryRecord): CardEntry {
  const attrs: CardEntry['attrs'] = {};

  for (const key of CARD_ATTR_KEYS) {
    const value = entry.attrs[key];
    if (value && value.length > 0) {
      attrs[key] = value;
    }
  }

  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    namespace: entry.namespace,
    rev: entry.rev,
    version: entry.version,
    description: entry.description,
    attrs,
  };
}

export function toFull(entry: EntryRecord): EntryRecord {
  return entry;
}
