import type { FilterNode } from '@/lib/filter/ast';

export type CompiledSql = {
  sql: string;
  params: Array<string | number>;
};

type TopLevelKey = 'id' | 'type' | 'name' | 'namespace' | 'version' | 'rev';

type KeyResolution =
  | {
      kind: 'top';
      field: TopLevelKey;
    }
  | {
      kind: 'attr';
      key: string;
    };

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['id', 'type', 'name', 'namespace', 'version', 'rev']);

export function compileToSql(ast: FilterNode): CompiledSql {
  const params: Array<string | number> = [];

  function addParam(value: string | number): string {
    params.push(value);
    return `$${params.length}`;
  }

  const sql = compileNode(ast, addParam);

  return { sql, params };
}

export function resolveFilterKey(inputKey: string): KeyResolution {
  if (inputKey.startsWith('attrs.')) {
    const attrKey = inputKey.slice('attrs.'.length);
    if (!attrKey) {
      throw invalidFilter('Attribute key must not be empty.');
    }

    return { kind: 'attr', key: attrKey };
  }

  if (TOP_LEVEL_KEYS.has(inputKey)) {
    return {
      kind: 'top',
      field: inputKey as TopLevelKey,
    };
  }

  return { kind: 'attr', key: inputKey };
}

function compileNode(ast: FilterNode, addParam: (value: string | number) => string): string {
  switch (ast.kind) {
    case 'and': {
      if (ast.children.length === 0) {
        throw invalidFilter('AND filter must contain at least one child.');
      }

      const parts = ast.children.map((child) => compileNode(child, addParam));
      return `(${parts.join(' AND ')})`;
    }

    case 'or': {
      if (ast.children.length === 0) {
        throw invalidFilter('OR filter must contain at least one child.');
      }

      const parts = ast.children.map((child) => compileNode(child, addParam));
      return `(${parts.join(' OR ')})`;
    }

    case 'not': {
      const childSql = compileNode(ast.child, addParam);
      return `(NOT (${childSql}))`;
    }

    case 'present': {
      const target = resolveFilterKey(ast.key);
      if (target.kind === 'top') {
        if (target.field === 'rev') {
          return '(rev IS NOT NULL)';
        }
        return `(${target.field} IS NOT NULL AND ${target.field} <> '')`;
      }

      const keyRef = addParam(target.key);
      return `(attrs ? ${keyRef}::text)`;
    }

    case 'eq': {
      const target = resolveFilterKey(ast.key);
      if (target.kind === 'top') {
        if (target.field === 'rev') {
          if (!/^-?\d+$/.test(ast.value.trim())) {
            throw invalidFilter('rev must be an integer.');
          }

          const revRef = addParam(Number.parseInt(ast.value.trim(), 10));
          return `(rev = ${revRef})`;
        }

        const valueRef = addParam(ast.value);
        return `(${target.field} = ${valueRef})`;
      }

      const keyRef = addParam(target.key);
      const valueRef = addParam(ast.value);
      return `(COALESCE(jsonb_extract_path(attrs, ${keyRef}::text) ? ${valueRef}::text, false))`;
    }

    default: {
      const impossible: never = ast;
      throw new Error(`Unknown AST node ${(impossible as { kind: string }).kind}`);
    }
  }
}

function invalidFilter(message: string): Error & { code: 'invalid_filter' } {
  const error = new Error(message) as Error & { code: 'invalid_filter' };
  error.code = 'invalid_filter';
  return error;
}
