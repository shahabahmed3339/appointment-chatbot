import bcrypt from 'bcryptjs';
import { userRepository, toPublicUser, PublicUser } from './user.repository';
import { signToken } from '@/server/lib/jwt';
import { ApiError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';

const BCRYPT_ROUNDS = 10;
const log = logger;

export interface AuthResult {
  user: PublicUser;
  token: string;
}

/**
 * Auth service. Business logic lives here so route handlers stay thin
 * (parse -> call service -> shape response) and so this logic is unit-testable
 * without HTTP.
 */
export const authService = {
  async signup(input: { email: string; password: string; fullName: string }): Promise<AuthResult> {
    const businessId = await userRepository.defaultBusinessId();
    const email = input.email.trim().toLowerCase();

    const existing = await userRepository.findByEmail(businessId, email);
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const row = await userRepository.create({
      businessId,
      email,
      passwordHash,
      fullName: input.fullName.trim(),
    });

    const token = await signToken({
      sub: row.id,
      email: row.email,
      businessId: row.business_id,
      role: row.role,
    });

    log.info('user_signup', { userId: row.id, email: row.email });
    return { user: toPublicUser(row), token };
  },

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const businessId = await userRepository.defaultBusinessId();
    const row = await userRepository.findByEmail(businessId, input.email.trim());

    // Deliberately generic message + a dummy compare path would be ideal; here we
    // keep one message for both "no user" and "bad password" to avoid user
    // enumeration, which is the security property that matters.
    if (!row) {
      log.warn('login_failed', { email: input.email, reason: 'no_user' });
      throw ApiError.unauthorized('Invalid email or password');
    }

    const valid = await bcrypt.compare(input.password, row.password_hash);
    if (!valid) {
      log.warn('login_failed', { email: input.email, reason: 'bad_password' });
      throw ApiError.unauthorized('Invalid email or password');
    }

    const token = await signToken({
      sub: row.id,
      email: row.email,
      businessId: row.business_id,
      role: row.role,
    });

    log.info('user_login', { userId: row.id });
    return { user: toPublicUser(row), token };
  },

  async me(userId: string): Promise<PublicUser> {
    const row = await userRepository.findById(userId);
    if (!row) throw ApiError.notFound('User not found');
    return toPublicUser(row);
  },
};
