import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  uuid,
  pgEnum,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

/**
 * CATALOGO
 * --------
 * Aqui vive la carta del restaurante y todo lo relacionado a como
 * cada plato afecta (o no) el inventario.
 *
 * Categorias de producto (decididas en la fase de analisis):
 *   A: insumo unico fraccionable (ej. pollo a la brasa por 1/8, 1/4, 1/2, entero)
 *      -> descuento automatico via receta, en la unidad minima fraccionable.
 *   B: reventa directa (ej. gaseosas, bebidas embotelladas)
 *      -> descuento automatico 1:1, sin receta.
 *   C: multi-insumo / preparacion libre (ej. lomo saltado, parrillas, pastas)
 *      -> NO se descuenta stock automaticamente. Solo se marca
 *         disponible/no disponible manualmente.
 */

// --- Categorías de la carta ---
export const categoriaCarta = pgTable('categoria_carta', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  slug: text('slug').notNull().unique(),
  descuentaStock: boolean('descuenta_stock').notNull().default(false),
  esParaCocina: boolean('es_para_cocina').notNull().default(true),
  orden: integer('orden').notNull().default(0),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// --- Insumos (solo aplica a categorias A y B) ---
// Para "pollo a la brasa", este es el registro de "pollo_entero",
// con su stock SIEMPRE expresado en la unidad minima fraccionable
// (ej. octavos), nunca en unidades enteras con resto decimal.
export const insumo = pgTable('insumo', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(), // ej. "Pollo entero", "Gaseosa Inca Kola 500ml"

  // Cuantas "unidades minimas" componen una unidad de compra.
  // Para pollo: 8 (octavos). Para una gaseosa: 1 (no es fraccionable,
  // cada botella vendida es 1 unidad consumida).
  unidadesPorUnidadDeCompra: integer('unidades_por_unidad_compra')
    .notNull()
    .default(1),

  // Nombre de la unidad minima, solo para mostrar en UI (ej. "octavo", "botella")
  nombreUnidadMinima: text('nombre_unidad_minima').notNull().default('unidad'),

  stockActual: integer('stock_actual').notNull().default(0), // en unidad minima

  // Avisar «Por reponer» cuando el stock baja de este numero (unidad minima).
  // 0 = sin aviso configurado.
  minimo: integer('minimo').notNull().default(0),

  // Como se llama la unidad en que LLEGA la compra ("pollo", "paquete", "caja").
  // La conversion a unidad minima es unidadesPorUnidadDeCompra.
  nombreUnidadCompra: text('nombre_unidad_compra').notNull().default('paquete'),

  // Posicion del insumo en la hoja de conteo (orden del almacen).
  ordenConteo: integer('orden_conteo').notNull().default(0),

  activo: boolean('activo').notNull().default(true),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// --- Carta: platos / productos que el mesero puede pedir ---
export const platoCarta = pgTable('plato_carta', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(), // ej. "1/4 Pollo a la brasa", "Lomo saltado", "Inca Kola 500ml"
  descripcion: text('descripcion'),
  // Si es true, la comanda de cocina imprime la descripción bajo el nombre
  // (una parte por línea, separadas por "+"). Apagado por defecto: la
  // descripción suele ser texto de carta, no una instrucción para cocina.
  mostrarDescripcionEnCocina: boolean('mostrar_descripcion_en_cocina')
    .notNull()
    .default(false),
  // Plato armable ("Arma tu dúo"): el mesero elige `elegir` de `opciones` al
  // pedirlo. Null = plato normal. Las opciones son texto, no platos de carta.
  combo: jsonb('combo').$type<{ elegir: number; opciones: string[] }>(),
  precio: numeric('precio', { precision: 10, scale: 2 }).notNull(),
  categoriaId: uuid('categoria_id')
    .notNull()
    .references(() => categoriaCarta.id, { onDelete: 'restrict' }),

  // Disponibilidad manual.
  disponible: boolean('disponible').notNull().default(true),

  activo: boolean('activo').notNull().default(true), // soft-delete del plato (deja de ofrecerse, no se borra historial)

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// --- Receta: cuanto consume un plato de un insumo (solo categorias A/B) ---
// Un plato de categoria A/B tiene exactamente UNA fila aqui (un solo insumo).
// Categoria C no tiene filas en esta tabla (por diseno: no se modela su receta).
export const recetaPlato = pgTable('receta_plato', {
  id: uuid('id').primaryKey().defaultRandom(),
  platoCartaId: uuid('plato_carta_id')
    .notNull()
    .references(() => platoCarta.id, { onDelete: 'cascade' }),
  insumoId: uuid('insumo_id')
    .notNull()
    .references(() => insumo.id, { onDelete: 'restrict' }),

  // Cuantas unidades minimas del insumo consume este plato.
  // "1/8 pollo" -> 1. "1/4 pollo" -> 2. "Pollo entero" -> 8. "Gaseosa" -> 1.
  cantidadConsumida: integer('cantidad_consumida').notNull(),
});

// --- Compra: encabezado de una recepcion de mercaderia ---
export const compraStock = pgTable('compra_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: text('usuario_id').references(() => user.id),
  proveedor: text('proveedor'), // proveedor o nota libre
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// --- Conteo: encabezado de un conteo fisico de inventario ---
export const conteoStock = pgTable('conteo_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: text('usuario_id').references(() => user.id),
  insumosContados: integer('insumos_contados').notNull().default(0),
  diferencias: integer('diferencias').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// --- Movimiento de stock: UNA fila por cada cambio del stock de un insumo ---
// Es el libro mayor del inventario: cuando no cuadra, aqui se ve en que
// momento y por quien cambio. `cantidad` lleva signo (unidad minima) y
// `saldo` es el stock resultante tras aplicarlo.
export const tipoMovimientoStockEnum = pgEnum('tipo_movimiento_stock', [
  'venta',
  'anulacion',
  'compra',
  'merma',
  'conteo',
  'correccion',
]);

export const movimientoStock = pgTable(
  'movimiento_stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => insumo.id, { onDelete: 'cascade' }),
    tipo: tipoMovimientoStockEnum('tipo').notNull(),
    cantidad: integer('cantidad').notNull(),
    saldo: integer('saldo').notNull(),
    usuarioId: text('usuario_id').references(() => user.id),
    motivo: text('motivo'),
    nota: text('nota'),
    // Origen (todos opcionales, segun el tipo)
    pedidoId: uuid('pedido_id'),
    platoCartaId: uuid('plato_carta_id'),
    compraId: uuid('compra_id').references(() => compraStock.id, {
      onDelete: 'set null',
    }),
    conteoId: uuid('conteo_id').references(() => conteoStock.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('movimiento_stock_insumo_fecha_idx').on(t.insumoId, t.createdAt)],
);
