import type { FilterNode } from '@/lib/filter/ast';

export class InvalidFilterError extends Error {
  code = 'invalid_filter' as const;
  position: number;
  details: { position: number };

  constructor(message: string, position: number) {
    super(message);
    this.name = 'InvalidFilterError';
    this.position = position;
    this.details = { position };
  }
}

const KEY_CHAR = /[A-Za-z0-9_.:\/-]/;
const TRAILING_WS = /[ \t\n\r]+$/;

class Parser {
  input: string;
  index = 0;

  constructor(input: string) {
    this.input = input;
  }

  parse(): FilterNode {
    this.skipWhitespace();
    const node = this.parseFilter();
    this.skipWhitespace();

    if (!this.isEof()) {
      throw this.error('Unexpected trailing characters.');
    }

    return node;
  }

  private parseFilter(): FilterNode {
    this.skipWhitespace();
    this.expect('(');
    this.skipWhitespace();

    const body = this.parseFilterBody();

    this.skipWhitespace();
    this.expect(')');

    return body;
  }

  private parseFilterBody(): FilterNode {
    const token = this.peek();

    if (!token) {
      throw this.error('Unexpected end of input in filter body.');
    }

    if (token === '&') {
      this.index += 1;
      const children = this.parseFilterList();
      return { kind: 'and', children };
    }

    if (token === '|') {
      this.index += 1;
      const children = this.parseFilterList();
      return { kind: 'or', children };
    }

    if (token === '!') {
      this.index += 1;
      this.skipWhitespace();
      const child = this.parseFilter();
      return { kind: 'not', child };
    }

    return this.parseItem();
  }

  private parseFilterList(): FilterNode[] {
    this.skipWhitespace();

    const children: FilterNode[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.peek() !== '(') {
        break;
      }
      children.push(this.parseFilter());
      this.skipWhitespace();
    }

    if (children.length === 0) {
      throw this.error('Expected at least one nested filter.');
    }

    return children;
  }

  private parseItem(): FilterNode {
    const key = this.parseKey();

    this.skipWhitespace();
    this.expect('=');
    this.skipWhitespace();

    if (this.isEof()) {
      throw this.error('Expected value after "=".');
    }

    if (this.peek() === '*') {
      const starStart = this.index;
      this.index += 1;

      const afterStar = this.index;
      this.skipWhitespace();

      if (this.peek() === ')') {
        return { kind: 'present', key };
      }

      this.index = starStart;
      const value = this.parseValue();
      this.index = Math.max(this.index, afterStar);

      return { kind: 'eq', key, value };
    }

    const value = this.parseValue();

    return { kind: 'eq', key, value };
  }

  private parseKey(): string {
    const start = this.index;

    while (!this.isEof() && KEY_CHAR.test(this.peek() ?? '')) {
      this.index += 1;
    }

    const key = this.input.slice(start, this.index);
    if (!key) {
      throw this.error('Expected a filter key.');
    }

    return key;
  }

  private parseValue(): string {
    let value = '';

    while (!this.isEof()) {
      const char = this.peek();

      if (char === ')') {
        break;
      }

      if (char === '\\') {
        this.index += 1;

        if (this.isEof()) {
          throw this.error('Incomplete escape sequence.');
        }

        const escaped = this.peek() as string;
        if (!['\\', '*', '(', ')'].includes(escaped)) {
          throw this.error(`Unsupported escape sequence: \\${escaped}`);
        }

        value += escaped;
        this.index += 1;
        continue;
      }

      if (char === '(') {
        throw this.error('Value contains unescaped "(".');
      }

      value += char;
      this.index += 1;
    }

    return value.replace(TRAILING_WS, '');
  }

  private expect(char: string): void {
    if (this.peek() !== char) {
      throw this.error(`Expected "${char}".`);
    }

    this.index += 1;
  }

  private skipWhitespace(): void {
    while (!this.isEof() && /[ \t\n\r]/.test(this.peek() ?? '')) {
      this.index += 1;
    }
  }

  private isEof(): boolean {
    return this.index >= this.input.length;
  }

  private peek(): string | undefined {
    return this.input[this.index];
  }

  private error(message: string): InvalidFilterError {
    return new InvalidFilterError(message, this.index);
  }
}

export function parseFilter(input: string): FilterNode {
  const parser = new Parser(input);
  return parser.parse();
}
