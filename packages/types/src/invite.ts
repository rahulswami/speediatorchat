import { z } from 'zod';

export const CreateInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'AGENT']).default('AGENT'),
});
export type CreateInviteDto = z.infer<typeof CreateInviteSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(8).max(72).optional(),
});
export type AcceptInviteDto = z.infer<typeof AcceptInviteSchema>;
