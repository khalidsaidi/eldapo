import type { EntryAttrs } from '@/lib/types';

export type Requester = {
  isAuthenticated: boolean;
  groups: Set<string>;
  subject: string | null;
};

type Visibility = 'public' | 'internal' | 'restricted';

export function parseRequester(req: Request): Requester {
  const trustedHeadersEnabled = process.env.ELDAPPO_TRUSTED_HEADERS === 'true';

  if (!trustedHeadersEnabled) {
    return {
      isAuthenticated: false,
      groups: new Set(),
      subject: null,
    };
  }

  const authHeader = req.headers.get('authorization');
  const subject = req.headers.get('x-eldapo-sub');
  const isAuthenticated = Boolean(authHeader || subject);

  if (!isAuthenticated) {
    return {
      isAuthenticated: false,
      groups: new Set(),
      subject: null,
    };
  }

  const groupsHeader = req.headers.get('x-eldapo-groups') ?? '';
  const groups = new Set(
    groupsHeader
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean),
  );

  return {
    isAuthenticated,
    groups,
    subject,
  };
}

export function canSee(entry: { attrs: EntryAttrs }, requester: Requester): boolean {
  const visibility = readVisibility(entry.attrs);

  if (visibility === 'public') {
    return true;
  }

  if (visibility === 'internal') {
    return requester.isAuthenticated;
  }

  if (!requester.isAuthenticated) {
    return false;
  }

  const allowedGroups = new Set(entry.attrs.allowed_group ?? []);
  if (allowedGroups.size === 0) {
    return false;
  }

  for (const group of requester.groups) {
    if (allowedGroups.has(group)) {
      return true;
    }
  }

  return false;
}

function readVisibility(attrs: EntryAttrs): Visibility {
  const value = attrs.visibility?.[0];

  if (value === 'internal' || value === 'restricted') {
    return value;
  }

  return 'public';
}
