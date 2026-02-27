import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for migrations.');
}

const sql = postgres(databaseUrl, { max: 1 });

async function run(): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), 'db/migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  for (const fileName of migrationFiles) {
    const alreadyApplied = await sql<{ name: string }[]>`
      SELECT name
      FROM schema_migrations
      WHERE name = ${fileName}
      LIMIT 1
    `;

    if (alreadyApplied.length > 0) {
      console.log(`skip ${fileName}`);
      continue;
    }

    const migrationSql = readFileSync(path.join(migrationsDir, fileName), 'utf8');

    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSql);
      await tx.unsafe(
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [fileName],
      );
    });

    console.log(`applied ${fileName}`);
  }
}

run()
  .then(async () => {
    await sql.end({ timeout: 5 });
    console.log('migrations complete');
  })
  .catch(async (error) => {
    console.error(error);
    await sql.end({ timeout: 5 });
    process.exitCode = 1;
  });
