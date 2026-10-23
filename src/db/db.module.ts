import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        // Las columnas son timestamp sin zona y drizzle las lee como UTC; si la
        // sesión usara la zona del servidor (America/Lima en el local), defaultNow()
        // guardaría hora de Lima y las horas saldrían 5 h antes en pantalla.
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          options: '-c timezone=UTC',
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
