import { describe, expect, it } from 'vitest';

import { parseFilter } from '@/lib/filter/parser';

describe('filter parser', () => {
  it('parses nested and filters', () => {
    const ast = parseFilter('(&(type=skill)(capability=summarize))');

    expect(ast).toEqual({
      kind: 'and',
      children: [
        { kind: 'eq', key: 'type', value: 'skill' },
        { kind: 'eq', key: 'capability', value: 'summarize' },
      ],
    });
  });

  it('parses attrs shorthand item', () => {
    const ast = parseFilter('(tag=finance)');

    expect(ast).toEqual({
      kind: 'eq',
      key: 'tag',
      value: 'finance',
    });
  });

  it('parses not filters', () => {
    const ast = parseFilter('(!(status=deprecated))');

    expect(ast).toEqual({
      kind: 'not',
      child: {
        kind: 'eq',
        key: 'status',
        value: 'deprecated',
      },
    });
  });

  it('parses presence filters', () => {
    const ast = parseFilter('(endpoint=*)');

    expect(ast).toEqual({
      kind: 'present',
      key: 'endpoint',
    });
  });

  it('parses escaped values', () => {
    const ast = parseFilter('(name=hello\\(\\)\\*)');

    expect(ast).toEqual({
      kind: 'eq',
      key: 'name',
      value: 'hello()*',
    });
  });

  it('tolerates extra whitespace', () => {
    const ast = parseFilter('( & ( type = skill ) ( tag = pdf ) )');

    expect(ast).toEqual({
      kind: 'and',
      children: [
        { kind: 'eq', key: 'type', value: 'skill' },
        { kind: 'eq', key: 'tag', value: 'pdf' },
      ],
    });
  });
});
