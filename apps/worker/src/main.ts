import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  const port = process.env.WORKER_PORT ?? 3002;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Worker running on http://0.0.0.0:${port}`);
}

bootstrap();
