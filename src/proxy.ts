import { NextRequest, NextResponse } from 'next/server';

const SET_STATUS_PATTERN = /^\/v1\/entries\/([^/]+):setStatus$/;

export function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;

  if (pathname === '/v1/entries:publish') {
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = '/v1/entries/publish';
    return NextResponse.rewrite(nextUrl);
  }

  const setStatusMatch = pathname.match(SET_STATUS_PATTERN);
  if (setStatusMatch) {
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = `/v1/entries/${setStatusMatch[1]}/setStatus`;
    return NextResponse.rewrite(nextUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/v1/entries:publish', '/v1/entries/:path*'],
};
