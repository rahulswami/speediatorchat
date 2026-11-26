import { z } from 'zod';

// docker-compose passes unset variables as empty strings.
const blankAsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  WHATSAPP_TOKEN_ENCRYPTION_KEY: z.string().length(64),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v20.0'),
  // App-level token Meta sends when verifying the webhook callback (Embedded Signup routes
  // every customer's webhooks to this one callback).
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: blankAsUnset(z.string().min(16).optional()),
  // Embedded Signup: both are public identifiers, shown to the browser.
  META_APP_ID: blankAsUnset(z.string().regex(/^\d+$/).optional()),
  META_EMBEDDED_SIGNUP_CONFIG_ID: blankAsUnset(z.string().regex(/^\d+$/).optional()),
  ANTHROPIC_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().optional(),
  APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    throw new Error(`Environment validation failed:\n${JSON.stringify(errors, null, 2)}`);
  }
  return result.data;
}
