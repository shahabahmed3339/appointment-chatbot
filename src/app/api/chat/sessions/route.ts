import { NextRequest } from 'next/server';
import { chatService } from '@/server/modules/chat/chat.service';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

/**
 * POST /api/chat/sessions
 * Creates a new chat session or resumes the caller's current active one.
 */
export const POST = withRequestLogging(
  handle(async (req: NextRequest) => {
    const auth = await getAuth(req);
    const session = await chatService.startOrResume(auth.businessId, auth.sub);
    return ok({ session }, 201);
  }),
);
