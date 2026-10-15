import { query } from '@/server/db/pool';

export interface UserRow {
  id: string;
  business_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  created_at: Date;
}

/** Public shape returned to clients — never includes password_hash. */
export interface PublicUser {
  id: string;
  businessId: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

export const userRepository = {
  async findByEmail(businessId: string, email: string): Promise<UserRow | null> {
    const rows = await query<UserRow>(
      `SELECT id, business_id, email, password_hash, full_name, role, created_at
         FROM users
        WHERE business_id = $1 AND lower(email) = lower($2)
        LIMIT 1`,
      [businessId, email],
    );
    return rows[0] ?? null;
  },

  async findById(id: string): Promise<UserRow | null> {
    const rows = await query<UserRow>(
      `SELECT id, business_id, email, password_hash, full_name, role, created_at
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create(input: {
    businessId: string;
    email: string;
    passwordHash: string;
    fullName: string;
    role?: string;
  }): Promise<UserRow> {
    const rows = await query<UserRow>(
      `INSERT INTO users (business_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, business_id, email, password_hash, full_name, role, created_at`,
      [input.businessId, input.email, input.passwordHash, input.fullName, input.role ?? 'member'],
    );
    return rows[0];
  },

  /** The prototype is single-tenant; the seeded business is the default tenant. */
  async defaultBusinessId(): Promise<string> {
    const rows = await query<{ id: string }>(
      `SELECT id FROM businesses ORDER BY created_at ASC LIMIT 1`,
    );
    if (!rows[0]) throw new Error('No business exists. Run `npm run db:seed` first.');
    return rows[0].id;
  },
};
