import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'invalid_request'
  | 'invalid_filter'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'conflict'
  | 'internal';

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_filter: 400,
  not_found: 404,
  forbidden: 403,
  unauthorized: 401,
  conflict: 409,
  internal: 500,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = CODE_TO_STATUS[code];
    this.details = details;
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Request validation failed.',
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  if (isErrorWithCode(error, 'invalid_filter')) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_filter',
          message: error.message || 'Invalid filter.',
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: 400 },
    );
  }

  console.error(error);

  return NextResponse.json(
    {
      error: {
        code: 'internal',
        message: 'Internal server error.',
      },
    },
    { status: 500 },
  );
}

function isErrorWithCode(
  value: unknown,
  code: string,
): value is Error & { code: string; details?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    (value as { code: string }).code === code
  );
}
