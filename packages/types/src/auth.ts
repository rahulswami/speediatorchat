import { z } from 'zod';

export const RegisterSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  orgName: z.string().min(1).max(100),
  orgSlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  timezone: z.string().optional().default('Asia/Kolkata'),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutDto = z.infer<typeof LogoutSchema>;

export interface JwtPayload {
  sub: string;
  orgId: string;
  role: string;
  type: 'access';
  jti: string;
}

export interface RequestUser {
  userId: string;
  orgId: string;
  role: string;
}
