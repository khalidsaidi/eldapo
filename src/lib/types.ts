export type EntryAttrs = Record<string, string[]>;

export type EntryRecord = {
  id: string;
  rev: number;
  type: string;
  namespace: string;
  name: string;
  description: string;
  version: string | null;
  attrs: EntryAttrs;
  manifest: unknown;
  meta: unknown;
  created_at: string;
  updated_at: string;
};

export type CardEntry = {
  id: string;
  type: string;
  name: string;
  namespace: string;
  rev: number;
  version: string | null;
  description: string;
  attrs: Partial<EntryAttrs>;
};
