import { NextRequest } from 'next/server';
import { aiService } from '@/server/modules/ai/ai.service';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

/**
 * GET /api/ai/status — authenticated diagnostics.
 *
 * Reports which provider the app would use, the model, and whether each provider
 * in the chain has a credential. Deliberately never returns key material — only
 * booleans — so it is safe to expose to a logged-in user.
 */
export const GET = withRequestLogging(
  handle(async (req: NextRequest) => {
    await getAuth(req);
    return ok({ ai: aiService.status() });
  }),
);
