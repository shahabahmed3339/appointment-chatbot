import { z } from 'zod';

export const APPOINTMENT_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const;
export const APPOINTMENT_SOURCES = ['form', 'chat'] as const;

/** ISO-8601 string that also validates as a real date. */
const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid ISO-8601 date-time');

export const createAppointmentSchema = z
  .object({
    title: z.string().trim().min(2, 'Title must be at least 2 characters').max(160),
    notes: z.string().trim().max(2000).optional().nullable(),
    startsAt: isoDate,
    endsAt: isoDate,
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    source: z.enum(APPOINTMENT_SOURCES).optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine(
    (v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 8 * 60 * 60 * 1000,
    { message: 'Appointment cannot exceed 8 hours', path: ['endsAt'] },
  );

export const updateAppointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
});

export const listAppointmentsQuerySchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
