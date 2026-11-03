import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  pgEnum,
  serial,
  AnyPgColumn,
  numeric,
  jsonb,
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';
import { platoCarta } from './catalogo.schema';
import { promocion } from './promociones.schema';

/**
 * OPERACION
 * ---------
 * Modela el flujo real: mesero ocupa una mesa -> toma uno o varios
 * pedidos (rondas) durante la visita -> cocina prepara -> mesero entrega
 * -> caja cobra el total de la visita -> mesa se libera.
 *
 * Jerarquia: Mesa -> VisitaMesa (una "sesion" por cliente/grupo) -> Pedido
 * (una ronda dentro de esa sesion) -> ItemPedido (cada plato pedido).
 *
 * Se eligio "varios pedidos por visita" porque el cliente puede pedir
 * algo, comer, y luego pedir mas -> son rondas separadas, pero todas
 * deben sumarse en un solo total al momento de pagar en caja.
 */

export const estadoMesaEnum = pgEnum('estado_mesa', ['libre', 'ocupada']);

/**
 * Zonas del local (Salón principal, Terraza, Piso 2…). Cada zona decide si
 * se organiza con un plano (grilla filas × columnas, con referencias fijas
 * como Entrada o Barra) o solo por número de mesa.
 */
export const modoZonaEnum = pgEnum('modo_zona', ['plano', 'numeros']);

export interface ReferenciaPlano {
  id: string;
  etiqueta: string;
  fila: number;
  col: number;
  ancho: number;
  alto: number;
}

export const zona = pgTable('zona', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  orden: integer('orden').notNull().default(0),
  modo: modoZonaEnum('modo').notNull().default('plano'),
  filas: integer('filas').notNull().default(4),
  columnas: integer('columnas').notNull().default(6),
  referencias: jsonb('referencias').$type<ReferenciaPlano[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// «barra»: puesto en la barra (taburete). Se muestra como «Barra N», pero
// conserva su número único para comandas, caja y precuenta.
export const tipoMesaEnum = pgEnum('tipo_mesa', ['mesa', 'barra']);

export const mesa = pgTable('mesa', {
  id: uuid('id').primaryKey().defaultRandom(),
  numero: integer('numero').notNull().unique(), // ej. 1, 2, 3...
  estado: estadoMesaEnum('estado').notNull().default('libre'),
  capacidad: integer('capacidad'), // opcional, num. de personas

  // Posición en la grilla del salón. Si ambas son null se asume "sin posición":
  // el frontend del mesero las apila al final como antes. La grilla es densa
  // pero acepta huecos vacíos (filas/columnas faltantes).
  filaPosicion: integer('fila_posicion'),
  colPosicion: integer('col_posicion'),
  // Zona a la que pertenece; fila/col son relativas a ella. El número de
  // mesa sigue siendo único en todo el local.
  zonaId: uuid('zona_id').references(() => zona.id, { onDelete: 'set null' }),
  // Celdas que ocupa en el plano (1 normal, 2 mesa ancha).
  ancho: integer('ancho').notNull().default(1),
  tipo: tipoMesaEnum('tipo').notNull().default('mesa'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// --- Visita de mesa: agrupa todas las rondas de un mismo cliente/grupo ---
// Se abre cuando el mesero marca la mesa como ocupada (paso 1 del flujo).
// Se cierra cuando caja libera la mesa (paso 9 del flujo).
export const estadoVisitaEnum = pgEnum('estado_visita', ['abierta', 'cerrada']);
export const tipoVisitaEnum = pgEnum('tipo_visita', [
  'mesa',
  'llevar',
  'delivery',
]);

export const visitaMesa = pgTable('visita_mesa', {
  id: uuid('id').primaryKey().defaultRandom(),
  mesaId: uuid('mesa_id').references(() => mesa.id, { onDelete: 'restrict' }),

  abiertaPorUsuarioId: text('abierta_por_usuario_id')
    .notNull()
    .references(() => user.id), // mesero/cajero
  estado: estadoVisitaEnum('estado').notNull().default('abierta'),
  tipo: tipoVisitaEnum('tipo').notNull().default('mesa'),
  paraLlevar: boolean('para_llevar').notNull().default(false), // para llevar (+S/1 por plato elegible - obsoleto/removido recargo automático)

  nombreCliente: text('nombre_cliente'),
  telefonoCliente: text('telefono_cliente'),
  direccionDelivery: text('direccion_delivery'),
  costoEnvio: numeric('costo_envio', { precision: 10, scale: 2 }),

  fechaApertura: timestamp('fecha_apertura').notNull().defaultNow(),
  fechaCierre: timestamp('fecha_cierre'), // null mientras este abierta
});

// --- Pedido: una ronda dentro de una visita ---
export const estadoPedidoEnum = pgEnum('estado_pedido', [
  'pendiente', // tomado por el mesero, recien enviado a cocina
  'en_preparacion', // opcional: cocina ya lo esta cocinando (si se quiere distinguir de "pendiente")
  'listo', // cocina toco el timbre
  'entregado', // mesero ya lo entrego al cliente
  'cancelado', // por si se anula una ronda completa
]);

export const pedido = pgTable('pedido', {
  id: uuid('id').primaryKey().defaultRandom(),
  visitaMesaId: uuid('visita_mesa_id')
    .notNull()
    .references(() => visitaMesa.id, { onDelete: 'restrict' }),
  tomadoPorUsuarioId: text('tomado_por_usuario_id')
    .notNull()
    .references(() => user.id), // mesero

  // Correlativo legible para trazar la ronda entre mesa y cocina ("R-0428").
  // Se asigna automáticamente con un sequence global, sin reset diario.
  numeroCorto: serial('numero_corto').notNull(),

  // Marca de "para llevar" a nivel de RONDA (no de visita): el cliente puede
  // estar comiendo en mesa y pedir solo una parte en tupper. La cocina lo lee
  // del ticket para saber cómo emplatar; el cobro del tupper se hace agregando
  // el producto "Tupper" manualmente (no hay recargo automático).
  paraLlevar: boolean('para_llevar').notNull().default(false),
  nombreClienteLlevar: text('nombre_cliente_llevar'),

  // Motivo de cancelación (obligatorio si estado='cancelado'). Texto libre, pero
  // el UI ofrece chips con motivos comunes ("demoró mucho", "ya no quiere"...).
  motivoCancelacion: text('motivo_cancelacion'),

  estado: estadoPedidoEnum('estado').notNull().default('pendiente'),

  fechaCreacion: timestamp('fecha_creacion').notNull().defaultNow(),
  fechaListo: timestamp('fecha_listo'), // cuando cocina toco el timbre
  fechaEntregado: timestamp('fecha_entregado'), // cuando el mesero lo entrego
});

// --- Item de pedido: cada plato dentro de una ronda, con su personalizacion ---
export const estadoItemPedidoEnum = pgEnum('estado_item_pedido', [
  'pendiente',
  'listo',
  'entregado',
  'cancelado',
]);

export const itemPedido = pgTable('item_pedido', {
  id: uuid('id').primaryKey().defaultRandom(),
  pedidoId: uuid('pedido_id')
    .notNull()
    .references(() => pedido.id, { onDelete: 'cascade' }),
  platoCartaId: uuid('plato_carta_id')
    .notNull()
    .references(() => platoCarta.id, { onDelete: 'restrict' }),

  cantidad: integer('cantidad').notNull().default(1),

  // Precio del plato AL MOMENTO de pedirlo. Se copia desde plato_carta.precio
  // para que si el precio de la carta cambia despues, el historico no se altere.
  precioUnitarioCongelado: text('precio_unitario_congelado').notNull(),

  // Descuento aplicado al precio unitario por una promoción vigente al momento
  // del pedido. Se guarda como monto absoluto en soles por unidad (no porcentaje),
  // así el recibo y los reportes pueden mostrarlo sin recomputar.
  // El precioUnitarioCongelado YA incluye este descuento restado.
  descuentoUnitario: text('descuento_unitario').notNull().default('0.00'),
  promocionAplicadaId: uuid('promocion_aplicada_id').references(
    (): AnyPgColumn => promocion.id,
    { onDelete: 'set null' },
  ),

  // Personalizacion en texto libre: "sin crema", "sin aji", "sin arroz", etc.
  // No se modela como opciones estructuradas de la carta -- es una nota
  // operativa del mesero, no una variante de producto con su propio precio.
  notas: text('notas'),

  // Elecciones de un plato armable (platoCarta.combo): una entrada por opción
  // elegida, p. ej. ["Ceviche clásico", "Chaufa de mariscos"]. Null si no aplica.
  elecciones: jsonb('elecciones').$type<string[]>(),

  estado: estadoItemPedidoEnum('estado').notNull().default('pendiente'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
});
