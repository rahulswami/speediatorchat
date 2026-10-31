import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { createFastifyAdapter, configureApp } from './create-app';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await configureApp(app);

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API running on http://0.0.0.0:${port}`);
}

bootstrap();
