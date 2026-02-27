import 'dotenv/config';

import postgres from 'postgres';

import { compileToSql } from '../../src/lib/filter/compileToSql';
import { parseFilter } from '../../src/lib/filter/parser';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for explain plans.');
}

const sql = postgres(databaseUrl, { max: 1 });

const filters = [
  '(type=skill)',
  '(&(type=skill)(capability=summarize))',
  '(&(type=rag)(capability=retrieve)(tag=finance))',
];

async function run(): Promise<void> {
  for (const filter of filters) {
    const ast = parseFilter(filter);
    const compiled = compileToSql(ast);

    const explainSql = `
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT id, rev, type, namespace, name, description, version, attrs, updated_at
      FROM entries_latest
      WHERE ${compiled.sql}
      ORDER BY updated_at DESC, id DESC
      LIMIT 20
    `;

    const rows = (await sql.unsafe(explainSql, compiled.params as never[])) as Array<Record<string, string>>;

    console.log(`\n=== filter: ${filter} ===`);
    for (const row of rows) {
      console.log(row['QUERY PLAN']);
    }
  }
}

run()
  .then(async () => {
    await sql.end({ timeout: 5 });
  })
  .catch(async (error) => {
    console.error(error);
    await sql.end({ timeout: 5 });
    process.exitCode = 1;
  });
