import { NextRequest } from 'next/server';
import { authService } from '@/server/modules/auth/auth.service';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

export const GET = withRequestLogging(
  handle(async (req: NextRequest) => {
    const auth = await getAuth(req);
    const user = await authService.me(auth.sub);
    return ok({ user });
  }),
);
