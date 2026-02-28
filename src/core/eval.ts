import { RoaringBitmap32 } from 'roaring-wasm';

import type { FilterNode } from '@/lib/filter/ast';

import { eqToken, presentToken, resolveCoreKey } from './keys';

type PostingGetter = (token: string) => RoaringBitmap32 | null;

type EvalContext = {
  getPosting: PostingGetter;
  universe: RoaringBitmap32;
};

type EvalResult = {
  bitmap: RoaringBitmap32;
  owned: boolean;
};

export function evaluateFilterAst(ast: FilterNode, context: EvalContext): RoaringBitmap32 {
  const result = evalNode(ast, context);

  if (result.owned) {
    return result.bitmap;
  }

  return result.bitmap.clone();
}

function evalNode(ast: FilterNode, context: EvalContext): EvalResult {
  switch (ast.kind) {
    case 'eq': {
      const resolved = resolveCoreKey(ast.key);
      const token = eqToken(resolved.scope, resolved.key, ast.value);
      return borrowPosting(context.getPosting(token));
    }

    case 'present': {
      const resolved = resolveCoreKey(ast.key);
      const token = presentToken(resolved.scope, resolved.key);
      return borrowPosting(context.getPosting(token));
    }

    case 'and': {
      if (ast.children.length === 0) {
        return {
          bitmap: new RoaringBitmap32(),
          owned: true,
        };
      }

      const sortedChildren = [...ast.children].sort((left, right) => {
        return estimateCardinality(left, context) - estimateCardinality(right, context);
      });

      let accumulator: EvalResult | null = null;

      for (const child of sortedChildren) {
        const childResult = evalNode(child, context);

        if (!accumulator) {
          if (childResult.owned) {
            accumulator = childResult;
          } else {
            accumulator = {
              bitmap: childResult.bitmap.clone(),
              owned: true,
            };
          }

          if (accumulator.bitmap.isEmpty) {
            break;
          }

          continue;
        }

        accumulator.bitmap.andInPlace(childResult.bitmap);

        if (childResult.owned) {
          childResult.bitmap.dispose();
        }

        if (accumulator.bitmap.isEmpty) {
          break;
        }
      }

      return (
        accumulator ?? {
          bitmap: new RoaringBitmap32(),
          owned: true,
        }
      );
    }

    case 'or': {
      if (ast.children.length === 0) {
        return {
          bitmap: new RoaringBitmap32(),
          owned: true,
        };
      }

      const accumulator = new RoaringBitmap32();
      for (const child of ast.children) {
        const childResult = evalNode(child, context);
        accumulator.orInPlace(childResult.bitmap);

        if (childResult.owned) {
          childResult.bitmap.dispose();
        }
      }

      return {
        bitmap: accumulator,
        owned: true,
      };
    }

    case 'not': {
      const childResult = evalNode(ast.child, context);
      const accumulator = context.universe.clone();
      accumulator.andNotInPlace(childResult.bitmap);

      if (childResult.owned) {
        childResult.bitmap.dispose();
      }

      return {
        bitmap: accumulator,
        owned: true,
      };
    }

    default: {
      const impossible: never = ast;
      throw new Error(`Unsupported filter node: ${(impossible as { kind: string }).kind}`);
    }
  }
}

function borrowPosting(posting: RoaringBitmap32 | null): EvalResult {
  if (!posting) {
    return {
      bitmap: new RoaringBitmap32(),
      owned: true,
    };
  }

  return {
    bitmap: posting,
    owned: false,
  };
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
