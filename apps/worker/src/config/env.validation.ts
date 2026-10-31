import { z } from 'zod';

const WorkerEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  WHATSAPP_TOKEN_ENCRYPTION_KEY: z.string().length(64),
  WHATSAPP_API_VERSION: z.string().default('v20.0'),
  ANTHROPIC_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WORKER_PORT: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function validateEnv(config: Record<string, unknown>): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    throw new Error(`Worker environment validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }
  return result.data;
}
