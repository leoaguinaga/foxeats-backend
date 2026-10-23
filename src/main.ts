import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { auth } from './auth/auth.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  app.use('/api/auth/{*splat}', toNodeHandler(auth));

  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix('api', { exclude: ['auth/(.*)'] });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
