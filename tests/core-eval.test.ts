import { RoaringBitmap32 } from 'roaring-wasm';
import { describe, expect, it } from 'vitest';

import { evaluateFilterAst } from '@/core/eval';
import { eqToken, presentToken, resolveCoreKey } from '@/core/keys';
import type { FilterNode } from '@/lib/filter/ast';
import { parseFilter } from '@/lib/filter/parser';

describe('core evaluator', () => {
  it('matches reference semantics for nested and/or/not combinations', () => {
    const { postings, universe, dispose } = buildFixture();

    try {
      const filters = [
        '(&(type=skill)(capability=summarize)(env=prod))',
        '(|(tag=finance)(capability=summarize))',
        '(!(tag=finance))',
        '(&(endpoint=*)(!(tag=finance))(type=skill))',
        '(tag=__never__)',
      ];

      for (const rawFilter of filters) {
        const ast = parseFilter(rawFilter);
        const actual = evaluateFilterAst(ast, {
          getPosting: (token) => postings.get(token) ?? null,
          universe,
        });
        const expected = evaluateReference(ast, postings, universe);

        expect([...actual]).toEqual([...expected]);

        actual.dispose();
        expected.dispose();
      }
    } finally {
      dispose();
    }
  });

  it('does not mutate backing postings across repeated queries', () => {
    const { postings, universe, dispose } = buildFixture();
    const snapshot = new Map<string, number[]>();
    for (const [token, posting] of postings.entries()) {
      snapshot.set(token, [...posting]);
    }

    try {
      const ast = parseFilter('(&(type=skill)(capability=summarize)(env=prod))');

      for (let index = 0; index < 20; index += 1) {
        const result = evaluateFilterAst(ast, {
          getPosting: (token) => postings.get(token) ?? null,
          universe,
        });
        result.dispose();
      }

      for (const [token, posting] of postings.entries()) {
        expect([...posting]).toEqual(snapshot.get(token));
      }
    } finally {
      dispose();
    }
  });

  it('returns empty quickly for missing leaf postings', () => {
    const { postings, universe, dispose } = buildFixture();

    try {
      const ast = parseFilter('(&(type=skill)(tag=__never__))');
      const result = evaluateFilterAst(ast, {
        getPosting: (token) => postings.get(token) ?? null,
        universe,
      });

      expect(result.isEmpty).toBe(true);
      result.dispose();
    } finally {
      dispose();
    }
  });
});

function buildFixture(): {
  postings: Map<string, RoaringBitmap32>;
  universe: RoaringBitmap32;
  dispose: () => void;
} {
  const postings = new Map<string, RoaringBitmap32>();
  const universe = bitmapOf([1, 2, 3, 4, 5, 6]);

  postings.set(eqToken('top', 'type', 'skill'), bitmapOf([1, 2, 3, 4]));
  postings.set(eqToken('attr', 'capability', 'summarize'), bitmapOf([1, 2, 5]));
  postings.set(eqToken('attr', 'env', 'prod'), bitmapOf([1, 3, 5]));
  postings.set(eqToken('attr', 'tag', 'finance'), bitmapOf([2, 4, 6]));
  postings.set(presentToken('attr', 'endpoint'), bitmapOf([1, 2, 3, 4, 5, 6]));

  return {
    postings,
    universe,
    dispose: () => {
      for (const posting of postings.values()) {
        posting.dispose();
      }
      universe.dispose();
    },
  };
}

function bitmapOf(values: number[]): RoaringBitmap32 {
  const bitmap = new RoaringBitmap32();
  for (const value of values) {
    bitmap.add(value);
  }

  return bitmap;
}

function evaluateReference(
  ast: FilterNode,
  postings: Map<string, RoaringBitmap32>,
  universe: RoaringBitmap32,
): RoaringBitmap32 {
  switch (ast.kind) {
    case 'eq': {
      const resolved = resolveCoreKey(ast.key);
      const token = eqToken(resolved.scope, resolved.key, ast.value);
      return postings.get(token)?.clone() ?? new RoaringBitmap32();
    }

    case 'present': {
      const resolved = resolveCoreKey(ast.key);
      const token = presentToken(resolved.scope, resolved.key);
      return postings.get(token)?.clone() ?? new RoaringBitmap32();
    }

    case 'and': {
      if (ast.children.length === 0) {
        return new RoaringBitmap32();
      }

      const result = evaluateReference(ast.children[0], postings, universe);
      for (let index = 1; index < ast.children.length; index += 1) {
        const child = evaluateReference(ast.children[index], postings, universe);
        result.andInPlace(child);
        child.dispose();
      }

      return result;
    }

    case 'or': {
      const result = new RoaringBitmap32();
      for (const childNode of ast.children) {
        const child = evaluateReference(childNode, postings, universe);
        result.orInPlace(child);
        child.dispose();
      }
      return result;
    }

    case 'not': {
      const result = universe.clone();
      const child = evaluateReference(ast.child, postings, universe);
      result.andNotInPlace(child);
      child.dispose();
      return result;
    }

    default: {
      const impossible: never = ast;
      throw new Error(`Unsupported filter node: ${(impossible as { kind: string }).kind}`);
    }
  }
}
