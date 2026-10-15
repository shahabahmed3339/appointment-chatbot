import { NextRequest } from 'next/server';
import { appointmentService } from '@/server/modules/appointments/appointment.service';
import { updateAppointmentStatusSchema } from '@/server/modules/appointments/appointment.schema';
import { getAuth } from '@/server/lib/auth';
import { ok, handle } from '@/server/lib/http';
import { ApiError } from '@/server/lib/errors';
import { withRequestLogging } from '@/server/lib/requestLogger';

export const runtime = 'nodejs';

/** GET /api/appointments/:id — fetch a single appointment. */
export const GET = withRequestLogging(
  handle(async (req: NextRequest, ctx: { params: { id: string } }) => {
    const auth = await getAuth(req);
    const appointment = await appointmentService.getById(auth.businessId, auth.sub, ctx.params.id);
    return ok({ appointment });
  }),
);

/** PATCH /api/appointments/:id — update status (confirm / cancel / complete). */
export const PATCH = withRequestLogging(
  handle(async (req: NextRequest, ctx: { params: { id: string } }) => {
    const auth = await getAuth(req);

    const body = await req.json().catch(() => null);
    const parsed = updateAppointmentStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.validation('Invalid appointment payload', parsed.error.flatten().fieldErrors);
    }

    const appointment = await appointmentService.updateStatus(
      auth.businessId,
      auth.sub,
      ctx.params.id,
      parsed.data.status,
    );
    return ok({ appointment });
  }),
);
