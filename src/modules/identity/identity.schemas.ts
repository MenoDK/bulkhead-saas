import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password';

export const NICHES = ['general', 'restaurant', 'legal', 'civic', 'wellness'] as const;
export type Niche = (typeof NICHES)[number];

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const registerSchema = z.object({
  email,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  name: z.string().trim().min(1).max(120),
  tenantName: z.string().trim().min(1).max(120),
  niche: z.enum(NICHES).default('general'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  tenantId: z.uuid().optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
