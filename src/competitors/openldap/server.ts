import { createServer } from 'node:http';

import { Client } from 'ldapts';

import type { FilterNode } from '@/lib/filter/ast';
import { resolveFilterKey } from '@/lib/filter/compileToSql';
import { parseFilter } from '@/lib/filter/parser';

const host = process.env.ELDAPPO_RACE_LDAP_HOST ?? '127.0.0.1';
const port = Number(process.env.ELDAPPO_RACE_LDAP_PORT ?? 4203);
const ldapUrl = process.env.ELDAPPO_RACE_LDAP_URL ?? 'ldap://127.0.0.1:3890';
const bindDn = process.env.ELDAPPO_RACE_LDAP_BIND_DN ?? 'cn=admin,dc=eldapo,dc=local';
const bindPass = process.env.ELDAPPO_RACE_LDAP_BIND_PASS ?? 'admin';
const baseDn = process.env.ELDAPPO_RACE_LDAP_BASE_DN ?? 'dc=eldapo,dc=local';

const entriesBaseDn = `ou=entries,${baseDn}`;
const MATCH_ALL = '(objectClass=*)';
const NO_MATCH = '(uid=__eldapo_no_match__)';

async function main(): Promise<void> {
  const client = new Client({ url: ldapUrl, timeout: 15000, connectTimeout: 10000 });
  await client.bind(bindDn, bindPass);

  const server = createServer((req, res) => {
    void handleRequest(client, req, res);
  });

  server.listen(port, host, () => {
    console.log(`openldap race server listening on http://${host}:${port}`);
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await client.unbind().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}

async function handleRequest(
  client: Client,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const origin = `http://${req.headers.host ?? `${host}:${port}`}`;
  const url = new URL(req.url ?? '/', origin);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'GET' || url.pathname !== '/search') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const rawLimit = Number(url.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 0), 200) : 20;
  const rawFilter = url.searchParams.get('filter');

  let ldapFilter = MATCH_ALL;

  try {
    if (rawFilter) {
      const ast = parseFilter(rawFilter);
      ldapFilter = compileLdapFilter(ast);
    }
  } catch (error) {
    sendJson(res, 400, {
      error: 'invalid_filter',
      message: error instanceof Error ? error.message : 'Invalid filter.',
    });
    return;
  }

  try {
    const result = await client.search(entriesBaseDn, {
      scope: 'sub',
      filter: ldapFilter,
      attributes: ['uid'],
      sizeLimit: limit,
    });

    const ids: string[] = [];

    for (const entry of result.searchEntries) {
      const uid = entry.uid;
      if (Array.isArray(uid)) {
        for (const candidate of uid) {
          ids.push(String(candidate));
        }
        continue;
      }

      if (uid) {
        ids.push(String(uid));
      }
    }

    sendJson(res, 200, {
      ids: ids.slice(0, limit),
      count: ids.length,
    });
  } catch (error) {
    console.error('ldap request failed', error);
    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Search failed.',
    });
  }
}

function compileLdapFilter(node: FilterNode): string {
  switch (node.kind) {
    case 'and': {
      const children = node.children.map((child) => compileLdapFilter(child));
      if (children.includes(NO_MATCH)) {
        return NO_MATCH;
      }
      if (children.length === 1) {
        return children[0];
      }
      return `(&${children.join('')})`;
    }

    case 'or': {
      const children = node.children.map((child) => compileLdapFilter(child));
      const meaningful = children.filter((child) => child !== NO_MATCH);
      if (meaningful.length === 0) {
        return NO_MATCH;
      }
      if (meaningful.length === 1) {
        return meaningful[0];
      }
      return `(|${meaningful.join('')})`;
    }

    case 'not': {
      const child = compileLdapFilter(node.child);
      if (child === NO_MATCH) {
        return MATCH_ALL;
      }
      return `(!${child})`;
    }

    case 'eq': {
      const attribute = resolveLdapAttribute(node.key);
      if (!attribute) {
        return NO_MATCH;
      }
      return `(${attribute}=${escapeFilterValue(node.value)})`;
    }

    case 'present': {
      const attribute = resolveLdapAttribute(node.key);
      if (!attribute) {
        return NO_MATCH;
      }
      return `(${attribute}=*)`;
    }

    default: {
      const impossible: never = node;
      throw new Error(`Unknown filter kind ${(impossible as { kind: string }).kind}`);
    }
  }
}

function resolveLdapAttribute(rawKey: string): string | null {
  const resolved = resolveFilterKey(rawKey);

  if (resolved.kind === 'top') {
    switch (resolved.field) {
      case 'type':
        return 'ou';
      case 'namespace':
        return 'o';
      case 'id':
        return 'uid';
      default:
        return null;
    }
  }

  switch (resolved.key) {
    case 'type':
      return 'ou';
    case 'namespace':
      return 'o';
    case 'env':
      return 'l';
    case 'status':
      return 'title';
    case 'visibility':
      return 'employeeType';
    case 'tag':
      return 'businessCategory';
    case 'capability':
      return 'departmentNumber';
    case 'endpoint':
      return 'labeledURI';
    case 'id':
      return 'uid';
    default:
      return null;
  }
}

function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\u0000/g, '\\00');
}

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
