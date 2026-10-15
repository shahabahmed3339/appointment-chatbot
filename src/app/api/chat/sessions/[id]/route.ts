import { NextRequest } from 'next/server';
import { chatService } from '@/server/modules/chat/chat.service';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

/** GET /api/chat/sessions/:id — session metadata + full message history. */
export const GET = withRequestLogging(
  handle(async (req: NextRequest, ctx: { params: { id: string } }) => {
    const auth = await getAuth(req);
    const result = await chatService.getSession(auth.businessId, auth.sub, ctx.params.id);
    return ok(result);
  }),
);
