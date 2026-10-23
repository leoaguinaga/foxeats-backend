import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const localConfig = pgTable('local_config', {
  id: text('id').primaryKey().default('principal'),
  nombre: text('nombre').notNull(),
  logo: text('logo'),
  direccion: text('direccion').notNull().default(''),
  telefono: text('telefono').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
