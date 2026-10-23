import { pgTable, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';

/**
 * IMPRESIÓN
 * ---------
 * Configuración de las ticketeras ESC/POS. Una fila por destino (cocina y
 * recibos), editable desde Administración → Ticketeras sin reiniciar el
 * servidor.
 *
 * - `simulada`: el ticket se escribe como texto en /dev-tickets.
 * - `red`: el ticket se envía por TCP a `ip:puerto`.
 */

export const tipoTicketeraEnum = pgEnum('tipo_ticketera', [
  'cocina',
  'recibos',
]);

export const modoTicketeraEnum = pgEnum('modo_ticketera', ['simulada', 'red']);

export const ticketera = pgTable('ticketera', {
  tipo: tipoTicketeraEnum('tipo').primaryKey(),
  modo: modoTicketeraEnum('modo').notNull().default('simulada'),
  ip: text('ip'),
  puerto: integer('puerto').notNull().default(9100),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
