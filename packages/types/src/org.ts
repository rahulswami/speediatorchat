import { z } from 'zod';

export const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});
export type UpdateOrgDto = z.infer<typeof UpdateOrgSchema>;
