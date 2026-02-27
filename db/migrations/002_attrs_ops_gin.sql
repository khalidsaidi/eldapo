CREATE INDEX IF NOT EXISTS entries_attrs_ops_gin ON entries USING GIN (attrs);
