export type FilterNode = AndNode | OrNode | NotNode | EqNode | PresentNode;

export type AndNode = {
  kind: 'and';
  children: FilterNode[];
};

export type OrNode = {
  kind: 'or';
  children: FilterNode[];
};

export type NotNode = {
  kind: 'not';
  child: FilterNode;
};

export type EqNode = {
  kind: 'eq';
  key: string;
  value: string;
};

export type PresentNode = {
  kind: 'present';
  key: string;
};
