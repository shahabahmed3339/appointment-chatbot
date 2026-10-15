import { NextRequest } from 'next/server';
import { chatService } from '@/server/modules/chat/chat.service';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

/**
 * POST /api/chat/sessions/:id/confirm
 * Turns the session's completed booking draft into a real appointment, using the
 * same validated service path as the booking form.
 */
export const POST = withRequestLogging(
  handle(async (req: NextRequest, ctx: { params: { id: string } }) => {
    const auth = await getAuth(req);
    const result = await chatService.confirmDraft({
      businessId: auth.businessId,
      userId: auth.sub,
      sessionId: ctx.params.id,
    });
    return ok(result, 201);
  }),
);
