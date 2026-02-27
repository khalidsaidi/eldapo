import { NextResponse } from 'next/server';

const DEFAULT_CORE_URL = 'http://127.0.0.1:4100';
const DEFAULT_TIMEOUT_MS = 1200;

export type CoreForwardOptions = {
  path: string;
  method?: 'GET' | 'POST';
  includeQuery?: boolean;
  bodyText?: string;
};

export async function forwardToCore(
  request: Request,
  options: CoreForwardOptions,
): Promise<NextResponse | null> {
  if (!isCoreEnabled()) {
    return null;
  }

  const upstreamUrl = buildUpstreamUrl(request, options);
  const headers = buildForwardHeaders(request.headers);

  if ((options.method ?? request.method).toUpperCase() === 'POST' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const timeoutMs = Number(process.env.ELDAPPO_CORE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(upstreamUrl, {
      method: options.method ?? request.method,
      headers,
      body: options.bodyText,
      signal: controller.signal,
    });

    return toNextResponse(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isCoreEnabled(): boolean {
  return process.env.ELDAPPO_USE_CORE === 'true';
}

function buildUpstreamUrl(request: Request, options: CoreForwardOptions): string {
  const baseUrl = process.env.ELDAPPO_CORE_URL ?? DEFAULT_CORE_URL;
  const target = new URL(options.path, baseUrl);

  if (options.includeQuery) {
    const source = new URL(request.url);
    target.search = source.search;
  }

  return target.toString();
}

function buildForwardHeaders(input: Headers): Headers {
  const headers = new Headers();

  forwardIfPresent(input, headers, 'authorization');
  forwardIfPresent(input, headers, 'x-eldapo-sub');
  forwardIfPresent(input, headers, 'x-eldapo-groups');
  forwardIfPresent(input, headers, 'content-type');

  return headers;
}

function forwardIfPresent(input: Headers, output: Headers, name: string): void {
  const value = input.get(name);
  if (value) {
    output.set(name, value);
  }
}

async function toNextResponse(response: Response): Promise<NextResponse> {
  const payload = await response.text();
  const headers = new Headers();

  const contentType = response.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }

  return new NextResponse(payload, {
    status: response.status,
    headers,
  });
}
