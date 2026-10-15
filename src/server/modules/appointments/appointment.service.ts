import {
  appointmentRepository,
  toAppointment,
  Appointment,
  AppointmentStatus,
  AppointmentSource,
} from './appointment.repository';
import { ApiError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';

const log = logger;

export interface CreateAppointmentParams {
  businessId: string;
  userId: string;
  title: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
  status?: AppointmentStatus;
  source?: AppointmentSource;
}

/**
 * Appointment service — the single write path for bookings.
 *
 * Deliberately the ONLY way an appointment is created, whether it came from the
 * booking form or from an AI-extracted chat conversation. The AI layer never
 * writes to the database directly; it produces a validated draft that is then
 * passed through exactly the same guards as a human-submitted form. That is the
 * core "clear boundary between AI and business logic" property of this design.
 */
export const appointmentService = {
  async list(
    businessId: string,
    userId: string,
    opts: { status?: AppointmentStatus } = {},
  ): Promise<Appointment[]> {
    const rows = await appointmentRepository.listForUser(businessId, userId, opts);
    return rows.map(toAppointment);
  },

  async getById(businessId: string, userId: string, id: string): Promise<Appointment> {
    const row = await appointmentRepository.findById(businessId, id);
    // Scoped lookup: a row from another tenant or another user is simply "not found",
    // which avoids leaking existence across tenants.
    if (!row || row.user_id !== userId) throw ApiError.notFound('Appointment not found');
    return toAppointment(row);
  },

  async create(params: CreateAppointmentParams): Promise<Appointment> {
    const startsAt = new Date(params.startsAt);
    const endsAt = new Date(params.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw ApiError.validation('Invalid date range');
    }
    if (endsAt <= startsAt) {
      throw ApiError.validation('endsAt must be after startsAt', { endsAt: ['Must be after startsAt'] });
    }

    const row = await appointmentRepository.create({
      businessId: params.businessId,
      userId: params.userId,
      title: params.title.trim(),
      notes: params.notes?.trim() || null,
      startsAt,
      endsAt,
      status: params.status,
      source: params.source ?? 'form',
    });

    log.info('appointment_created', {
      appointmentId: row.id,
      userId: params.userId,
      source: row.source,
      status: row.status,
    });

    return toAppointment(row);
  },

  async updateStatus(
    businessId: string,
    userId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<Appointment> {
    const existing = await appointmentRepository.findById(businessId, id);
    if (!existing || existing.user_id !== userId) {
      throw ApiError.notFound('Appointment not found');
    }

    const row = await appointmentRepository.updateStatus(businessId, id, status);
    if (!row) throw ApiError.notFound('Appointment not found');

    log.info('appointment_status_updated', { appointmentId: id, status });
    return toAppointment(row);
  },
};
