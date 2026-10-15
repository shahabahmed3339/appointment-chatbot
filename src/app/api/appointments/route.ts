import { NextRequest } from 'next/server';
import { appointmentService } from '@/server/modules/appointments/appointment.service';
import {
  createAppointmentSchema,
  listAppointmentsQuerySchema,
} from '@/server/modules/appointments/appointment.schema';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { ApiError } from '@/server/lib/errors';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

/** GET /api/appointments — list the caller's appointments (optional ?status=). */
export const GET = withRequestLogging(
  handle(async (req: NextRequest) => {
    const auth = await getAuth(req);

    const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = listAppointmentsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw ApiError.validation('Invalid query parameters', parsed.error.flatten().fieldErrors);
    }

    const items = await appointmentService.list(auth.businessId, auth.sub, {
      status: parsed.data.status,
    });
    return ok({ appointments: items });
  }),
);

/** POST /api/appointments — create from the booking form or an accepted AI draft. */
export const POST = withRequestLogging(
  handle(async (req: NextRequest) => {
    const auth = await getAuth(req);

    const body = await req.json().catch(() => null);
    const parsed = createAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.validation('Invalid appointment payload', parsed.error.flatten().fieldErrors);
    }

    const appointment = await appointmentService.create({
      businessId: auth.businessId,
      userId: auth.sub,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      source: parsed.data.source ?? 'form',
    });

    return ok({ appointment }, 201);
  }),
);
