import { RoaringBitmap32 } from 'roaring-wasm';

import type { FilterNode } from '@/lib/filter/ast';

import { eqToken, presentToken, resolveCoreKey } from './keys';

type PostingGetter = (token: string) => RoaringBitmap32 | null;

type EvalContext = {
  getPosting: PostingGetter;
  universe: RoaringBitmap32;
};

export function evaluateFilterAst(ast: FilterNode, context: EvalContext): RoaringBitmap32 {
  return evalNode(ast, context);
}

function evalNode(ast: FilterNode, context: EvalContext): RoaringBitmap32 {
  switch (ast.kind) {
    case 'eq': {
      const resolved = resolveCoreKey(ast.key);
      const token = eqToken(resolved.scope, resolved.key, ast.value);
      return cloneOrEmpty(context.getPosting(token));
    }

    case 'present': {
      const resolved = resolveCoreKey(ast.key);
      const token = presentToken(resolved.scope, resolved.key);
      return cloneOrEmpty(context.getPosting(token));
    }

    case 'and': {
      if (ast.children.length === 0) {
        return new RoaringBitmap32();
      }

      const sortedChildren = [...ast.children].sort((left, right) => {
        return estimateCardinality(left, context) - estimateCardinality(right, context);
      });

      let result: RoaringBitmap32 | null = null;

      for (const child of sortedChildren) {
        const childBitmap = evalNode(child, context);

        if (result === null) {
          result = childBitmap;
          if (result.isEmpty) {
            break;
          }
          continue;
        }

        result.andInPlace(childBitmap);
        childBitmap.dispose();

        if (result.isEmpty) {
          break;
        }
      }

      return result ?? new RoaringBitmap32();
    }

    case 'or': {
      if (ast.children.length === 0) {
        return new RoaringBitmap32();
      }

      const result = new RoaringBitmap32();
      for (const child of ast.children) {
        const childBitmap = evalNode(child, context);
        result.orInPlace(childBitmap);
        childBitmap.dispose();
      }

      return result;
    }

    case 'not': {
      const result = context.universe.clone();
      const child = evalNode(ast.child, context);
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

function estimateCardinality(ast: FilterNode, context: EvalContext): number {
  switch (ast.kind) {
    case 'eq': {
      const resolved = resolveCoreKey(ast.key);
      const token = eqToken(resolved.scope, resolved.key, ast.value);
      return context.getPosting(token)?.size ?? 0;
    }

    case 'present': {
      const resolved = resolveCoreKey(ast.key);
      const token = presentToken(resolved.scope, resolved.key);
      return context.getPosting(token)?.size ?? 0;
    }

    case 'and': {
      if (ast.children.length === 0) {
        return 0;
      }

      return Math.min(...ast.children.map((child) => estimateCardinality(child, context)));
    }

    case 'or': {
      return ast.children.reduce((total, child) => total + estimateCardinality(child, context), 0);
    }

    case 'not': {
      const universe = context.universe.size;
      return Math.max(0, universe - estimateCardinality(ast.child, context));
    }

    default: {
      const impossible: never = ast;
      throw new Error(`Unsupported filter node: ${(impossible as { kind: string }).kind}`);
    }
  }
}

function cloneOrEmpty(bitmap: RoaringBitmap32 | null): RoaringBitmap32 {
  return bitmap ? bitmap.clone() : new RoaringBitmap32();
}
