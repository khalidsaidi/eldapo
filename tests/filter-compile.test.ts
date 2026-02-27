import { describe, expect, it } from 'vitest';

import { compileToSql } from '@/lib/filter/compileToSql';
import { parseFilter } from '@/lib/filter/parser';

describe('compileToSql', () => {
  it('compiles nested filters to placeholder SQL', () => {
    const ast = parseFilter('(&(type=skill)(capability=summarize))');
    const compiled = compileToSql(ast);

    expect(compiled.sql).toBe('((type = $1) AND (attrs @> $2::jsonb))');
    expect(compiled.params).toEqual(['skill', '{"capability":["summarize"]}']);
  });

  it('compiles rev as integer comparison', () => {
    const ast = parseFilter('(rev=42)');
    const compiled = compileToSql(ast);

    expect(compiled.sql).toContain('rev = $1');
    expect(compiled.params).toEqual([42]);
  });

  it('throws on non-integer rev values', () => {
    const ast = parseFilter('(rev=abc)');

    expect(() => compileToSql(ast)).toThrow(/integer/i);
  });

  it('keeps user strings in params and out of SQL', () => {
    const userValue = "x' OR 1=1 --";
    const ast = parseFilter(`(name=${userValue})`);
    const compiled = compileToSql(ast);

    expect(compiled.sql).toMatch(/\$1/);
    expect(compiled.sql).not.toContain(userValue);
    expect(compiled.params).toEqual([userValue]);
  });

  it('maintains placeholder order', () => {
    const ast = parseFilter('(&(attrs.tag=finance)(namespace=acme)(rev=2))');
    const compiled = compileToSql(ast);

    expect(compiled.params).toEqual(['{"tag":["finance"]}', 'acme', 2]);
    expect(compiled.sql).toContain('$1');
    expect(compiled.sql).toContain('$2');
    expect(compiled.sql).toContain('$3');
  });

  it('keeps presence semantics using key-exists operator', () => {
    const ast = parseFilter('(endpoint=*)');
    const compiled = compileToSql(ast);

    expect(compiled.sql).toBe('(attrs ? $1::text)');
    expect(compiled.params).toEqual(['endpoint']);
  });
});
