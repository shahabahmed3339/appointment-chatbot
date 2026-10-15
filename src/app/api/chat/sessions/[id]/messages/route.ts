import { NextRequest } from 'next/server';
import { z } from 'zod';
import { chatService } from '@/server/modules/chat/chat.service';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { ApiError } from '@/server/lib/errors';
import { enforceRateLimit, RATE_LIMITS } from '@/server/lib/rateLimit';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

const bodySchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});

/**
 * POST /api/chat/sessions/:id/messages
 * Sends a user message and returns the assistant's reply plus the updated
 * booking draft. This is the REST path — it always works, even if the
 * streaming/socket layer is unavailable.
 */
export const POST = withRequestLogging(
  handle(async (req: NextRequest, ctx: { params: { id: string } }) => {
    const auth = await getAuth(req);
    enforceRateLimit(req, RATE_LIMITS.chat);

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.validation('Invalid message payload', parsed.error.flatten().fieldErrors);
    }

    const result = await chatService.sendMessage({
      businessId: auth.businessId,
      userId: auth.sub,
      sessionId: ctx.params.id,
      content: parsed.data.content,
    });

    return ok(result, 201);
  }),
);
