import { Client } from 'ldapts';

import { firstAttr, forEachBenchEntry } from './common';

type Args = {
  file?: string;
  url: string;
  bindDn: string;
  bindPass: string;
  baseDn: string;
  flush: boolean;
  concurrency: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    throw new Error(
      'Usage: pnpm race:load:ldap --file=.ai/bench/dataset-100000.jsonl [--flush] [--url=ldap://127.0.0.1:3890] [--bind-dn=cn=admin,dc=eldapo,dc=local] [--bind-pass=admin] [--base-dn=dc=eldapo,dc=local]',
    );
  }

  const client = new Client({ url: args.url, timeout: 15000, connectTimeout: 10000 });
  const entriesDn = `ou=entries,${args.baseDn}`;

  await client.bind(args.bindDn, args.bindPass);

  try {
    if (args.flush) {
      await deleteSubtree(client, entriesDn);
    }

    await ensureEntriesOu(client, entriesDn);

    const pending = new Set<Promise<void>>();
    let loaded = 0;

    const count = await forEachBenchEntry(args.file, async (entry) => {
      const addPromise = addEntry(client, entriesDn, {
        id: entry.id,
        type: entry.type,
        namespace: entry.namespace,
        env: firstAttr(entry, 'env'),
        status: firstAttr(entry, 'status'),
        visibility: firstAttr(entry, 'visibility'),
        tags: entry.attrs.tag ?? [],
        capabilities: entry.attrs.capability ?? [],
        endpoints: entry.attrs.endpoint ?? [],
      }).finally(() => {
        pending.delete(addPromise);
      });

      pending.add(addPromise);

      if (pending.size >= args.concurrency) {
        await Promise.race(pending);
      }

      loaded += 1;

      if (loaded % 5_000 === 0) {
        console.log(`loaded ${loaded} entries into ldap...`);
      }
    });

    await Promise.all(pending);
    console.log(`loaded ${loaded} ldap entries from ${args.file} (lines read: ${count})`);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

async function ensureEntriesOu(client: Client, entriesDn: string): Promise<void> {
  try {
    await client.add(entriesDn, {
      objectClass: ['top', 'organizationalUnit'],
      ou: 'entries',
    });
  } catch (error) {
    if (isResultCode(error, 68)) {
      return;
    }

    throw error;
  }
}

async function deleteSubtree(client: Client, rootDn: string): Promise<void> {
  let dns: string[] = [];

  try {
    const result = await client.search(rootDn, {
      scope: 'sub',
      filter: '(objectClass=*)',
      attributes: ['dn'],
      sizeLimit: 0,
    });

    dns = result.searchEntries.map((entry) => String(entry.dn));
  } catch (error) {
    if (isResultCode(error, 32)) {
      return;
    }

    throw error;
  }

  const sorted = dns
    .filter(Boolean)
    .sort((left, right) => dnDepth(right) - dnDepth(left));

  for (const dn of sorted) {
    try {
      await client.del(dn);
    } catch (error) {
      if (isResultCode(error, 32)) {
        continue;
      }

      throw error;
    }
  }
}

async function addEntry(
  client: Client,
  entriesDn: string,
  entry: {
    id: string;
    type: string;
    namespace: string;
    env: string;
    status: string;
    visibility: string;
    tags: string[];
    capabilities: string[];
    endpoints: string[];
  },
): Promise<void> {
  const dn = `uid=${escapeDnValue(entry.id)},${entriesDn}`;

  const attributes: Record<string, string | string[]> = {
    objectClass: ['top', 'inetOrgPerson', 'organizationalPerson', 'extensibleObject'],
    cn: entry.id,
    sn: 'bench',
    uid: entry.id,
    ou: entry.type,
    o: entry.namespace,
  };

  if (entry.env) {
    attributes.l = entry.env;
  }

  if (entry.status) {
    attributes.title = entry.status;
  }

  if (entry.visibility) {
    attributes.employeeType = entry.visibility;
  }

  if (entry.tags.length > 0) {
    attributes.businessCategory = entry.tags;
  }

  if (entry.capabilities.length > 0) {
    attributes.departmentNumber = entry.capabilities;
  }

  if (entry.endpoints.length > 0) {
    attributes.labeledURI = entry.endpoints;
  }

  try {
    await client.add(dn, attributes);
  } catch (error) {
    if (isResultCode(error, 68)) {
      return;
    }

    throw error;
  }
}

function dnDepth(dn: string): number {
  return dn.split(',').length;
}

function escapeDnValue(value: string): string {
  let escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\+/g, '\\+')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/^#/g, '\\#');

  escaped = escaped.replace(/^ +/, (spaces) => '\\ '.repeat(spaces.length));
  escaped = escaped.replace(/ +$/, (spaces) => '\\ '.repeat(spaces.length));
  return escaped;
}

function isResultCode(error: unknown, code: number): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const maybe = error as { code?: unknown };
  return maybe.code === code;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    url: 'ldap://127.0.0.1:3890',
    bindDn: 'cn=admin,dc=eldapo,dc=local',
    bindPass: 'admin',
    baseDn: 'dc=eldapo,dc=local',
    flush: false,
    concurrency: 25,
  };

  for (const arg of argv) {
    if (arg === '--flush') {
      parsed.flush = true;
      continue;
    }

    if (arg.startsWith('--file=')) {
      parsed.file = arg.slice('--file='.length);
      continue;
    }

    if (arg.startsWith('--url=')) {
      parsed.url = arg.slice('--url='.length);
      continue;
    }

    if (arg.startsWith('--bind-dn=')) {
      parsed.bindDn = arg.slice('--bind-dn='.length);
      continue;
    }

    if (arg.startsWith('--bind-pass=')) {
      parsed.bindPass = arg.slice('--bind-pass='.length);
      continue;
    }

    if (arg.startsWith('--base-dn=')) {
      parsed.baseDn = arg.slice('--base-dn='.length);
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      const value = Number(arg.slice('--concurrency='.length));
      if (Number.isInteger(value) && value > 0) {
        parsed.concurrency = value;
      }
    }
  }

  return parsed;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
