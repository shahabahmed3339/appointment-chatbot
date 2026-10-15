import { query } from '@/server/db/pool';
import { ApiError } from '@/server/lib/errors';

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type AppointmentSource = 'form' | 'chat';

/** Row shape as stored in PostgreSQL. */
export interface AppointmentRow {
  id: string;
  business_id: string;
  user_id: string;
  title: string;
  notes: string | null;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  source: AppointmentSource;
  created_at: Date;
  updated_at: Date;
}

/** Public shape returned to clients (camelCase, ISO timestamps). */
export interface Appointment {
  id: string;
  businessId: string;
  userId: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  createdAt: string;
  updatedAt: string;
}

export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** PostgreSQL exclusion-constraint violation. */
const EXCLUSION_VIOLATION = '23P01';

export const appointmentRepository = {
  async listForUser(
    businessId: string,
    userId: string,
    opts: { status?: AppointmentStatus } = {},
  ): Promise<AppointmentRow[]> {
    const params: unknown[] = [businessId, userId];
    let sql = `
      SELECT id, business_id, user_id, title, notes, starts_at, ends_at, status, source, created_at, updated_at
        FROM appointments
       WHERE business_id = $1 AND user_id = $2`;

    if (opts.status) {
      params.push(opts.status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ' ORDER BY starts_at DESC';
    return query<AppointmentRow>(sql, params);
  },

  async findById(businessId: string, id: string): Promise<AppointmentRow | null> {
    const rows = await query<AppointmentRow>(
      `SELECT id, business_id, user_id, title, notes, starts_at, ends_at, status, source, created_at, updated_at
         FROM appointments
        WHERE business_id = $1 AND id = $2`,
      [businessId, id],
    );
    return rows[0] ?? null;
  },

  async create(input: {
    businessId: string;
    userId: string;
    title: string;
    notes?: string | null;
    startsAt: Date;
    endsAt: Date;
    status?: AppointmentStatus;
    source?: AppointmentSource;
  }): Promise<AppointmentRow> {
    try {
      const rows = await query<AppointmentRow>(
        `INSERT INTO appointments (business_id, user_id, title, notes, starts_at, ends_at, status, source)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'pending')::appointment_status, COALESCE($8, 'form'))
         RETURNING id, business_id, user_id, title, notes, starts_at, ends_at, status, source, created_at, updated_at`,
        [
          input.businessId,
          input.userId,
          input.title,
          input.notes ?? null,
          input.startsAt,
          input.endsAt,
          input.status ?? null,
          input.source ?? null,
        ],
      );
      return rows[0];
    } catch (err) {
      // Translate the DB-level overlap guard into a clean 409. This is the key
      // safety property: the exclusion constraint, not application logic, is what
      // makes double-booking impossible under concurrency.
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === EXCLUSION_VIOLATION) {
        throw ApiError.conflict('That time slot is already booked');
      }
      throw err;
    }
  },

  async updateStatus(
    businessId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<AppointmentRow | null> {
    const rows = await query<AppointmentRow>(
      `UPDATE appointments
          SET status = $1::appointment_status
        WHERE business_id = $2 AND id = $3
        RETURNING id, business_id, user_id, title, notes, starts_at, ends_at, status, source, created_at, updated_at`,
      [status, businessId, id],
    );
    return rows[0] ?? null;
  },
};
