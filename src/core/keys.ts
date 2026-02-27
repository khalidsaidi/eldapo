import type { SearchCursor } from '@/lib/entries';
import { resolveFilterKey } from '@/lib/filter/compileToSql';

export type CoreKeyScope = 'top' | 'attr';

export type ResolvedCoreKey = {
  scope: CoreKeyScope;
  key: string;
};

export function resolveCoreKey(rawKey: string): ResolvedCoreKey {
  const resolved = resolveFilterKey(rawKey);

  if (resolved.kind === 'top') {
    return {
      scope: 'top',
      key: resolved.field,
    };
  }

  return {
    scope: 'attr',
    key: resolved.key,
  };
}

export function eqToken(scope: CoreKeyScope, key: string, value: string): string {
  return `${scope}:k:${key}\u0000v:${value}`;
}

export function presentToken(scope: CoreKeyScope, key: string): string {
  return `${scope}:k:${key}\u0000*`;
}

export function compareSortKeys(
  aUpdatedAt: string,
  aId: string,
  bUpdatedAt: string,
  bId: string,
): number {
  if (aUpdatedAt > bUpdatedAt) {
    return -1;
  }
  if (aUpdatedAt < bUpdatedAt) {
    return 1;
  }

  if (aId > bId) {
    return -1;
  }
  if (aId < bId) {
    return 1;
  }

  return 0;
}

export function isAfterCursor(updatedAt: string, id: string, cursor: SearchCursor): boolean {
  if (updatedAt < cursor.updated_at) {
    return true;
  }

  if (updatedAt > cursor.updated_at) {
    return false;
  }

  return id < cursor.id;
}
