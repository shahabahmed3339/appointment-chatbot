import { NextRequest } from 'next/server';
import { authService } from '@/server/modules/auth/auth.service';
import { loginSchema } from '@/server/modules/auth/auth.schema';
import { ok, handle } from '@/server/lib/http';
import { ApiError } from '@/server/lib/errors';
import { enforceRateLimit, RATE_LIMITS } from '@/server/lib/rateLimit';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

export const POST = withRequestLogging(
  handle(async (req: NextRequest) => {
    enforceRateLimit(req, RATE_LIMITS.auth);

    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.validation('Invalid login payload', parsed.error.flatten().fieldErrors);
    }

    const result = await authService.login(parsed.data);
    return ok(result);
  }),
);
