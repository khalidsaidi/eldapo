import { performance } from 'node:perf_hooks';

import { RoaringBitmap32 } from 'roaring-wasm';

import { canSee, type Requester } from '@/lib/access';
import { encodeCursor, type SearchCursor } from '@/lib/entries';
import type { FilterNode } from '@/lib/filter/ast';
import type { CardEntry, EntryRecord } from '@/lib/types';
import { toCard } from '@/lib/view';

import { evaluateFilterAst } from './eval';
import { compareSortKeys, eqToken, isAfterCursor, presentToken } from './keys';

const TOP_LEVEL_INDEX_FIELDS = ['id', 'type', 'name', 'namespace', 'version', 'rev'] as const;

type TopLevelIndexField = (typeof TOP_LEVEL_INDEX_FIELDS)[number];

type TokenBag = {
  eqTokens: Set<string>;
  presenceTokens: Set<string>;
};

type IndexedDoc = {
  docId: number;
  entry: EntryRecord;
  card: CardEntry;
  nameLower: string;
  descriptionLower: string;
};

export type CoreSearchOptions = {
  limit: number;
  cursor: SearchCursor | null;
  q?: string;
};

export type CoreSearchHit = {
  entry: EntryRecord;
  card: CardEntry;
};

export type CoreSearchResult = {
  items: CoreSearchHit[];
  next_cursor: string | null;
};

export type CoreBatchGetResult = {
  items: CoreSearchHit[];
  omitted: number;
};

export type CoreStats = {
  docs: number;
  eqTokens: number;
  presenceTokens: number;
  postingsCardinality: number;
  memoryApprox: number;
  buildMs: number;
};

export interface CoreIndex {
  buildFromSnapshot(rows: EntryRecord[]): void;
  applyChange(change: { id: string; rev: number }, row: EntryRecord | null): void;
  search(filterAst: FilterNode | null, options: CoreSearchOptions, requester: Requester): CoreSearchResult;
  read(id: string, requester: Requester): CoreSearchHit | null;
  batchGet(ids: string[], requester: Requester): CoreBatchGetResult;
  stats(): CoreStats;
}

export class InMemoryCoreIndex implements CoreIndex {
  private nextDocId = 1;
  private idToDoc = new Map<string, number>();
  private docs = new Map<number, IndexedDoc>();
  private tokenToPosting = new Map<string, RoaringBitmap32>();
  private presenceToPosting = new Map<string, RoaringBitmap32>();
  private universe = new RoaringBitmap32();
  private updatedOrder: number[] = [];
  private buildMs = 0;

  buildFromSnapshot(rows: EntryRecord[]): void {
    const startedAt = performance.now();

    this.reset();

    for (const row of rows) {
      this.upsertEntry(row, false);
    }

    this.resortUpdatedOrder();
    this.buildMs = Math.round((performance.now() - startedAt) * 100) / 100;
  }

  applyChange(change: { id: string; rev: number }, row: EntryRecord | null): void {
    if (!row) {
      return;
    }

    const existingDocId = this.idToDoc.get(change.id);
    if (existingDocId !== undefined) {
      const existing = this.docs.get(existingDocId);
      if (existing && existing.entry.rev > change.rev) {
        return;
      }
    }

    this.upsertEntry(row, true);
  }

  search(filterAst: FilterNode | null, options: CoreSearchOptions, requester: Requester): CoreSearchResult {
    const limit = Math.min(Math.max(options.limit, 1), 200);
    const q = options.q?.trim().toLowerCase();
    const hasQ = Boolean(q);

    const candidates = filterAst
      ? evaluateFilterAst(filterAst, {
          getPosting: (token) => this.getPosting(token),
          universe: this.universe,
        })
      : this.universe.clone();

    try {
      const items: CoreSearchHit[] = [];
      let nextCursor: string | null = null;

      for (const docId of this.updatedOrder) {
        if (!candidates.has(docId)) {
          continue;
        }

        const indexed = this.docs.get(docId);
        if (!indexed) {
          continue;
        }

        if (options.cursor && !isAfterCursor(indexed.entry.updated_at, indexed.entry.id, options.cursor)) {
          continue;
        }

        if (hasQ && !matchesQuery(indexed, q as string)) {
          continue;
        }

        if (!canSee(indexed.entry, requester)) {
          continue;
        }

        items.push({
          entry: indexed.entry,
          card: indexed.card,
        });

        if (items.length >= limit) {
          nextCursor = encodeCursor({
            updated_at: indexed.entry.updated_at,
            id: indexed.entry.id,
          });
          break;
        }
      }

      return {
        items,
        next_cursor: nextCursor,
      };
    } finally {
      candidates.dispose();
    }
  }

  read(id: string, requester: Requester): CoreSearchHit | null {
    const docId = this.idToDoc.get(id);
    if (docId === undefined) {
      return null;
    }

    const indexed = this.docs.get(docId);
    if (!indexed || !canSee(indexed.entry, requester)) {
      return null;
    }

    return {
      entry: indexed.entry,
      card: indexed.card,
    };
  }

  batchGet(ids: string[], requester: Requester): CoreBatchGetResult {
    const items: CoreSearchHit[] = [];
    let omitted = 0;

    for (const id of ids) {
      const docId = this.idToDoc.get(id);
      if (docId === undefined) {
        continue;
      }

      const indexed = this.docs.get(docId);
      if (!indexed) {
        continue;
      }

      if (!canSee(indexed.entry, requester)) {
        omitted += 1;
        continue;
      }

      items.push({
        entry: indexed.entry,
        card: indexed.card,
      });
    }

    return {
      items,
      omitted,
    };
  }

  stats(): CoreStats {
    let postingsCardinality = 0;

    for (const posting of this.tokenToPosting.values()) {
      postingsCardinality += posting.size;
    }

    for (const posting of this.presenceToPosting.values()) {
      postingsCardinality += posting.size;
    }

    return {
      docs: this.docs.size,
      eqTokens: this.tokenToPosting.size,
      presenceTokens: this.presenceToPosting.size,
      postingsCardinality,
      memoryApprox: Math.round((postingsCardinality + this.universe.size) * 4),
      buildMs: this.buildMs,
    };
  }

  private upsertEntry(entry: EntryRecord, resortAfter: boolean): void {
    const existingDocId = this.idToDoc.get(entry.id);

    if (existingDocId !== undefined) {
      const existingDoc = this.docs.get(existingDocId);
      if (existingDoc && existingDoc.entry.rev > entry.rev) {
        return;
      }

      if (existingDoc) {
        this.removeEntryFromIndexes(existingDoc);
      }

      const nextDoc = buildIndexedDoc(existingDocId, entry);
      this.docs.set(existingDocId, nextDoc);
      this.addEntryToIndexes(nextDoc);

      if (resortAfter) {
        this.resortUpdatedOrder();
      }
      return;
    }

    const newDocId = this.nextDocId;
    this.nextDocId += 1;

    const indexed = buildIndexedDoc(newDocId, entry);
    this.idToDoc.set(entry.id, newDocId);
    this.docs.set(newDocId, indexed);
    this.addEntryToIndexes(indexed);

    if (resortAfter) {
      this.resortUpdatedOrder();
    }
  }

  private addEntryToIndexes(indexed: IndexedDoc): void {
    const tokens = buildTokenBag(indexed.entry);

    for (const token of tokens.eqTokens) {
      this.addPosting(this.tokenToPosting, token, indexed.docId);
    }

    for (const token of tokens.presenceTokens) {
      this.addPosting(this.presenceToPosting, token, indexed.docId);
    }

    this.universe.add(indexed.docId);
    this.updatedOrder.push(indexed.docId);
  }

  private removeEntryFromIndexes(indexed: IndexedDoc): void {
    const tokens = buildTokenBag(indexed.entry);

    for (const token of tokens.eqTokens) {
      this.removePosting(this.tokenToPosting, token, indexed.docId);
    }

    for (const token of tokens.presenceTokens) {
      this.removePosting(this.presenceToPosting, token, indexed.docId);
    }

    this.universe.delete(indexed.docId);
    this.updatedOrder = this.updatedOrder.filter((docId) => docId !== indexed.docId);
  }

  private addPosting(map: Map<string, RoaringBitmap32>, token: string, docId: number): void {
    let posting = map.get(token);
    if (!posting) {
      posting = new RoaringBitmap32();
      map.set(token, posting);
    }

    posting.add(docId);
  }

  private removePosting(map: Map<string, RoaringBitmap32>, token: string, docId: number): void {
    const posting = map.get(token);
    if (!posting) {
      return;
    }

    posting.delete(docId);

    if (posting.isEmpty) {
      posting.dispose();
      map.delete(token);
    }
  }

  private resortUpdatedOrder(): void {
    this.updatedOrder = [...this.docs.keys()].sort((leftDocId, rightDocId) => {
      const left = this.docs.get(leftDocId);
      const right = this.docs.get(rightDocId);

      if (!left || !right) {
        return 0;
      }

      return compareSortKeys(
        left.entry.updated_at,
        left.entry.id,
        right.entry.updated_at,
        right.entry.id,
      );
    });
  }

  private getPosting(token: string): RoaringBitmap32 | null {
    if (token.endsWith('\u0000*')) {
      return this.presenceToPosting.get(token) ?? null;
    }

    return this.tokenToPosting.get(token) ?? null;
  }

  private reset(): void {
    for (const posting of this.tokenToPosting.values()) {
      posting.dispose();
    }

    for (const posting of this.presenceToPosting.values()) {
      posting.dispose();
    }

    this.tokenToPosting.clear();
    this.presenceToPosting.clear();
    this.idToDoc.clear();
    this.docs.clear();
    this.updatedOrder = [];
    this.nextDocId = 1;

    this.universe.dispose();
    this.universe = new RoaringBitmap32();
  }
}

function buildIndexedDoc(docId: number, entry: EntryRecord): IndexedDoc {
  return {
    docId,
    entry,
    card: toCard(entry),
    nameLower: entry.name.toLowerCase(),
    descriptionLower: entry.description.toLowerCase(),
  };
}

function matchesQuery(indexed: IndexedDoc, q: string): boolean {
  return indexed.nameLower.includes(q) || indexed.descriptionLower.includes(q);
}

function buildTokenBag(entry: EntryRecord): TokenBag {
  const eqTokens = new Set<string>();
  const presenceTokens = new Set<string>();

  addTopLevelTokens(entry, eqTokens, presenceTokens);

  for (const [key, values] of Object.entries(entry.attrs)) {
    presenceTokens.add(presentToken('attr', key));

    for (const value of values) {
      eqTokens.add(eqToken('attr', key, value));
    }
  }

  return {
    eqTokens,
    presenceTokens,
  };
}

function addTopLevelTokens(entry: EntryRecord, eqTokens: Set<string>, presenceTokens: Set<string>): void {
  for (const key of TOP_LEVEL_INDEX_FIELDS) {
    if (key === 'version') {
      if (entry.version !== null && entry.version !== '') {
        eqTokens.add(eqToken('top', key, entry.version));
        presenceTokens.add(presentToken('top', key));
      }
      continue;
    }

    if (key === 'rev') {
      const rev = String(entry.rev);
      eqTokens.add(eqToken('top', key, rev));
      presenceTokens.add(presentToken('top', key));
      continue;
    }

    const value = entry[key as Exclude<TopLevelIndexField, 'version' | 'rev'>];
    if (value) {
      eqTokens.add(eqToken('top', key, value));
      presenceTokens.add(presentToken('top', key));
    }
  }
}
