import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('A valid email is required').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(120),
});

export const loginSchema = z.object({
  email: z.string().email('A valid email is required').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
