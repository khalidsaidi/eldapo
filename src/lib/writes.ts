import { AppError } from '@/lib/errors';

export function assertWriteAccess(request: Request): void {
  if (process.env.ELDAPPO_ENABLE_WRITES !== 'true') {
    throw new AppError('forbidden', 'Writes are disabled.');
  }

  const expectedAdminKey = process.env.ELDAPPO_ADMIN_KEY;
  const providedAdminKey = request.headers.get('x-eldapo-admin-key');

  if (!expectedAdminKey || providedAdminKey !== expectedAdminKey) {
    throw new AppError('unauthorized', 'Invalid admin credentials.');
  }
}
