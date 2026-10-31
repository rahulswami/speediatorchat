import { INestApplication } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

export function createFastifyAdapter() {
  const env = process.env.NODE_ENV;
  if (env === 'test') {
    return new FastifyAdapter({ logger: false });
  }
  return new FastifyAdapter({
    logger: env === 'production'
      ? { level: 'info', redact: ['req.headers.authorization'] }
      : { level: 'debug', transport: { target: 'pino-pretty' } },
  });
}

export async function configureApp(app: INestApplication) {
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:3000', credentials: true });
  await app.init();

  const fastify = (app as NestFastifyApplication).getHttpAdapter().getInstance();

  // Security headers (Phase 10) — only register when Fastify 5 is the runtime version
  const fastifyMajor = parseInt((fastify.version ?? '4').split('.')[0], 10);
  if (fastifyMajor >= 5) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await fastify.register(require('@fastify/helmet'), { contentSecurityPolicy: false });
  }

  // Replace NestJS's default JSON parser with one that also stashes the raw body.
  // Must happen AFTER app.init() (which registers the default parser) and
  // BEFORE the server starts accepting connections.
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await fastify.ready();
}
