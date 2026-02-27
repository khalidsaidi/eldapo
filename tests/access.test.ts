import { afterEach, describe, expect, it } from 'vitest';

import { canSee, parseRequester } from '@/lib/access';

const originalTrustedHeaders = process.env.ELDAPPO_TRUSTED_HEADERS;

afterEach(() => {
  process.env.ELDAPPO_TRUSTED_HEADERS = originalTrustedHeaders;
});

describe('access visibility', () => {
  it('allows public visibility to anonymous users', () => {
    const request = new Request('http://localhost');
    const requester = parseRequester(request);

    const allowed = canSee(
      {
        attrs: { visibility: ['public'] },
      },
      requester,
    );

    expect(allowed).toBe(true);
  });

  it('requires authentication for internal visibility', () => {
    process.env.ELDAPPO_TRUSTED_HEADERS = 'true';

    const anonymousRequest = new Request('http://localhost');
    const anonymousRequester = parseRequester(anonymousRequest);

    const authenticatedRequest = new Request('http://localhost', {
      headers: {
        authorization: 'Bearer token',
        'x-eldapo-sub': 'user-1',
      },
    });
    const authenticatedRequester = parseRequester(authenticatedRequest);

    const entry = {
      attrs: { visibility: ['internal'] },
    };

    expect(canSee(entry, anonymousRequester)).toBe(false);
    expect(canSee(entry, authenticatedRequester)).toBe(true);
  });

  it('enforces allowed_group on restricted visibility', () => {
    process.env.ELDAPPO_TRUSTED_HEADERS = 'true';

    const authorizedRequest = new Request('http://localhost', {
      headers: {
        authorization: 'Bearer token',
        'x-eldapo-sub': 'user-2',
        'x-eldapo-groups': 'finance,ops',
      },
    });

    const unauthorizedRequest = new Request('http://localhost', {
      headers: {
        authorization: 'Bearer token',
        'x-eldapo-sub': 'user-3',
        'x-eldapo-groups': 'eng',
      },
    });

    const entry = {
      attrs: {
        visibility: ['restricted'],
        allowed_group: ['finance', 'compliance'],
      },
    };

    expect(canSee(entry, parseRequester(authorizedRequest))).toBe(true);
    expect(canSee(entry, parseRequester(unauthorizedRequest))).toBe(false);
  });

  it('treats missing visibility as public', () => {
    process.env.ELDAPPO_TRUSTED_HEADERS = 'false';

    const request = new Request('http://localhost');
    const requester = parseRequester(request);

    expect(canSee({ attrs: {} }, requester)).toBe(true);
  });
});
