import 'dotenv/config';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for seeding.');
}

type SeedEntry = {
  id: string;
  rev: number;
  type: string;
  namespace: string;
  name: string;
  description: string;
  version: string | null;
  attrs: Record<string, string[]>;
  manifest: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
};

const seedEntries: SeedEntry[] = [
  {
    id: 'skill:acme:pdf-summarize',
    rev: 1,
    type: 'skill',
    namespace: 'acme',
    name: 'PDF Summarize',
    description: 'Summarize PDF files into concise notes.',
    version: '1.0.0',
    attrs: {
      capability: ['summarize'],
      tag: ['pdf', 'nlp'],
      status: ['active'],
      visibility: ['public'],
      owner: ['acme-ai'],
    },
    manifest: { runtime: 'node', endpoint: 'https://api.acme.dev/skill/pdf-summarize' },
    meta: { source: 'seed' },
  },
  {
    id: 'skill:acme:pdf-summarize',
    rev: 2,
    type: 'skill',
    namespace: 'acme',
    name: 'PDF Summarize',
    description: 'Summarize PDF files into concise, structured notes.',
    version: '1.1.0',
    attrs: {
      capability: ['summarize'],
      tag: ['pdf', 'nlp'],
      status: ['active'],
      visibility: ['public'],
      endpoint: ['https://api.acme.dev/skill/pdf-summarize/v2'],
      owner: ['acme-ai'],
    },
    manifest: { runtime: 'node', endpoint: 'https://api.acme.dev/skill/pdf-summarize/v2' },
    meta: { source: 'seed', changelog: 'improved extraction quality' },
  },
  {
    id: 'mcp:acme:finance-tools',
    rev: 1,
    type: 'mcp',
    namespace: 'acme',
    name: 'Finance Tools MCP',
    description: 'MCP server exposing internal finance calculators.',
    version: '0.9.0',
    attrs: {
      capability: ['calc', 'finance'],
      tag: ['finance'],
      status: ['active'],
      visibility: ['internal'],
      auth: ['sso'],
    },
    manifest: { protocol: 'mcp', endpoint: 'https://mcp.acme.dev/finance' },
    meta: { source: 'seed' },
  },
  {
    id: 'rag:acme:sec-filings',
    rev: 1,
    type: 'rag',
    namespace: 'acme',
    name: 'SEC Filings RAG',
    description: 'Retriever over SEC filings and annual reports.',
    version: '2026.01',
    attrs: {
      capability: ['retrieve'],
      tag: ['finance', 'compliance'],
      status: ['active'],
      visibility: ['restricted'],
      allowed_group: ['finance', 'compliance'],
    },
    manifest: { index: 'sec_filings', provider: 'pgvector' },
    meta: { source: 'seed' },
  },
  {
    id: 'skill:acme:meeting-minutes',
    rev: 1,
    type: 'skill',
    namespace: 'acme',
    name: 'Meeting Minutes',
    description: 'Creates actionable meeting notes from transcripts.',
    version: '2.0.0',
    attrs: {
      capability: ['summarize', 'extract-action-items'],
      tag: ['meetings', 'productivity'],
      status: ['active'],
      visibility: ['public'],
      env: ['prod'],
    },
    manifest: { runtime: 'node', endpoint: 'https://api.acme.dev/skill/minutes' },
    meta: { source: 'seed' },
  },
  {
    id: 'mcp:acme:code-search',
    rev: 1,
    type: 'mcp',
    namespace: 'acme',
    name: 'Code Search MCP',
    description: 'Restricted code search over private repositories.',
    version: '0.4.1',
    attrs: {
      capability: ['search'],
      tag: ['code', 'engineering'],
      status: ['active'],
      visibility: ['restricted'],
      allowed_group: ['eng'],
    },
    manifest: { protocol: 'mcp', endpoint: 'https://mcp.acme.dev/code-search' },
    meta: { source: 'seed' },
  },
];

const sql = postgres(databaseUrl, { max: 1 });

async function run(): Promise<void> {
  for (const entry of seedEntries) {
    await sql.unsafe(
      `
        INSERT INTO entries (
          id,
          rev,
          type,
          namespace,
          name,
          description,
          version,
          attrs,
          manifest,
          meta
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9::jsonb,
          $10::jsonb
        )
        ON CONFLICT (id, rev) DO NOTHING
      `,
      [
        entry.id,
        entry.rev,
        entry.type,
        entry.namespace,
        entry.name,
        entry.description,
        entry.version,
        JSON.stringify(entry.attrs),
        entry.manifest === null ? null : JSON.stringify(entry.manifest),
        entry.meta === null ? null : JSON.stringify(entry.meta),
      ],
    );
  }

  console.log(`seeded ${seedEntries.length} rows (idempotent)`);
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
