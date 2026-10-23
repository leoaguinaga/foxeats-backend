import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from './schema';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });

  // ─── Insumos con stock inicial del día de apertura ────────────────────────
  // stockActual está en unidades mínimas (octavos, botellas, etc.)

  const insumos = [
    {
      nombre: 'Pollo entero',
      unidadesPorUnidadDeCompra: 8,
      nombreUnidadMinima: 'octavo',
      nombreUnidadCompra: 'pollo',
      minimo: 16,
      stockActual: 40,
    }, // 5 pollos = 40 octavos
    {
      nombre: 'Inca Kola 500ml',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 24,
    },
    {
      nombre: 'Coca Cola 500ml',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 24,
    },
    {
      nombre: 'Sprite 500ml',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 0,
    }, // sin stock → no disponible
    {
      nombre: 'Inca Kola 1.5L',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 12,
    },
    {
      nombre: 'Coca Cola 1.5L',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 12,
    },
    {
      nombre: 'Agua San Luis 500ml',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 24,
    },
    {
      nombre: 'Cerveza Cusqueña 620ml',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 12,
    },
    {
      nombre: 'Cerveza Pilsen 620ml',
      unidadesPorUnidadDeCompra: 1,
      nombreUnidadMinima: 'botella',
      stockActual: 0,
    }, // sin stock → no disponible
  ];

  const insumoMap: Record<string, { id: string; stockActual: number }> = {};

  for (const data of insumos) {
    const [existing] = await db
      .select()
      .from(schema.insumo)
      .where(eq(schema.insumo.nombre, data.nombre));
    if (existing) {
      // Actualizar stock aunque el insumo ya exista
      await db
        .update(schema.insumo)
        .set({ stockActual: data.stockActual })
        .where(eq(schema.insumo.id, existing.id));
      insumoMap[data.nombre] = {
        id: existing.id,
        stockActual: data.stockActual,
      };
      console.log(
        `↻ Insumo actualizado: ${data.nombre} (stock: ${data.stockActual})`,
      );
    } else {
      const [row] = await db.insert(schema.insumo).values(data).returning();
      insumoMap[data.nombre] = { id: row.id, stockActual: data.stockActual };
      console.log(
        `✓ Insumo creado: ${data.nombre} (stock: ${data.stockActual})`,
      );
    }
  }

  // ─── Categorías de la carta ────────────────────────────────────────────────
  const categoriasDef = [
    { nombre: 'Pollo a la brasa', slug: 'pollo_a_la_brasa', descuentaStock: false, esParaCocina: true, orden: 1 },
    { nombre: 'Entradas', slug: 'entradas', descuentaStock: false, esParaCocina: true, orden: 2 },
    { nombre: 'Platos a la carta', slug: 'platos_a_la_carta', descuentaStock: false, esParaCocina: true, orden: 3 },
    { nombre: 'Parrillas', slug: 'parrillas', descuentaStock: false, esParaCocina: true, orden: 4 },
    { nombre: 'Parrillas Familiares', slug: 'parrillas_familiares', descuentaStock: false, esParaCocina: true, orden: 5 },
    { nombre: 'Pastas', slug: 'pastas', descuentaStock: false, esParaCocina: true, orden: 6 },
    { nombre: 'Guarniciones', slug: 'guarniciones', descuentaStock: false, esParaCocina: true, orden: 7 },
    { nombre: 'Refrescos o Jugos', slug: 'refrescos_jugos', descuentaStock: false, esParaCocina: false, orden: 8 },
    { nombre: 'Bebidas', slug: 'bebidas', descuentaStock: true, esParaCocina: false, orden: 9 },
    { nombre: 'Cócteles', slug: 'cocteles', descuentaStock: false, esParaCocina: false, orden: 10 },
    { nombre: 'Extras', slug: 'extras', descuentaStock: false, esParaCocina: false, orden: 11 },
  ];

  const catMap: Record<string, { id: string; descuentaStock: boolean }> = {};
  for (const c of categoriasDef) {
    const [existing] = await db
      .select()
      .from(schema.categoriaCarta)
      .where(eq(schema.categoriaCarta.slug, c.slug));
    if (existing) {
      catMap[c.slug] = { id: existing.id, descuentaStock: existing.descuentaStock };
    } else {
      const [row] = await db.insert(schema.categoriaCarta).values(c).returning();
      catMap[c.slug] = { id: row.id, descuentaStock: row.descuentaStock };
      console.log(`✓ Categoría creada: ${c.nombre}`);
    }
  }

  // ─── Platos de la carta ───────────────────────────────────────────────────

  const platos: Array<{
    nombre: string;
    precio: string;
    categoria: string;
    receta?: { insumo: string; cantidad: number };
  }> = [
    // Pollo a la brasa (se ignora stock/receta para evitar fricción operativa)
    {
      nombre: '1/8 Pollo a la brasa',
      precio: '12.00',
      categoria: 'pollo_a_la_brasa',
    },
    {
      nombre: '1/4 Pollo a la brasa',
      precio: '22.00',
      categoria: 'pollo_a_la_brasa',
    },
    {
      nombre: '1/2 Pollo a la brasa',
      precio: '40.00',
      categoria: 'pollo_a_la_brasa',
    },
    {
      nombre: 'Pollo entero a la brasa',
      precio: '75.00',
      categoria: 'pollo_a_la_brasa',
    },

    // Bebidas (descontables automáticamente 1:1)
    {
      nombre: 'Inca Kola 500ml',
      precio: '5.00',
      categoria: 'bebidas',
      receta: { insumo: 'Inca Kola 500ml', cantidad: 1 },
    },
    {
      nombre: 'Coca Cola 500ml',
      precio: '5.00',
      categoria: 'bebidas',
      receta: { insumo: 'Coca Cola 500ml', cantidad: 1 },
    },
    {
      nombre: 'Sprite 500ml',
      precio: '5.00',
      categoria: 'bebidas',
      receta: { insumo: 'Sprite 500ml', cantidad: 1 },
    },
    {
      nombre: 'Inca Kola 1.5L',
      precio: '12.00',
      categoria: 'bebidas',
      receta: { insumo: 'Inca Kola 1.5L', cantidad: 1 },
    },
    {
      nombre: 'Coca Cola 1.5L',
      precio: '12.00',
      categoria: 'bebidas',
      receta: { insumo: 'Coca Cola 1.5L', cantidad: 1 },
    },
    {
      nombre: 'Agua San Luis 500ml',
      precio: '3.00',
      categoria: 'bebidas',
      receta: { insumo: 'Agua San Luis 500ml', cantidad: 1 },
    },
    {
      nombre: 'Cerveza Cusqueña 620ml',
      precio: '12.00',
      categoria: 'bebidas',
      receta: { insumo: 'Cerveza Cusqueña 620ml', cantidad: 1 },
    },
    {
      nombre: 'Cerveza Pilsen 620ml',
      precio: '10.00',
      categoria: 'bebidas',
      receta: { insumo: 'Cerveza Pilsen 620ml', cantidad: 1 },
    },

    // Refrescos (bebidas preparadas sin descuento automático de stock)
    {
      nombre: 'Jarra de Chicha Morada',
      precio: '15.00',
      categoria: 'refrescos_jugos',
    },
    {
      nombre: 'Jarra de Limonada',
      precio: '12.00',
      categoria: 'refrescos_jugos',
    },

    // Cócteles (bebidas con alcohol preparadas sin descuento automático de stock)
    { nombre: 'Pisco Sour', precio: '18.00', categoria: 'cocteles' },
    { nombre: 'Chilcano de Pisco', precio: '16.00', categoria: 'cocteles' },

    // Comida / Platos a la carta
    { nombre: 'Lomo saltado', precio: '35.00', categoria: 'platos_a_la_carta' },
    { nombre: 'Arroz chaufa', precio: '30.00', categoria: 'platos_a_la_carta' },
    {
      nombre: 'Tallarin saltado',
      precio: '30.00',
      categoria: 'platos_a_la_carta',
    },
    {
      nombre: 'Parrilla familiar',
      precio: '90.00',
      categoria: 'parrillas_familiares',
    },
    { nombre: 'Ensalada de la casa', precio: '15.00', categoria: 'entradas' },
    {
      nombre: 'Porción de papas fritas',
      precio: '10.00',
      categoria: 'guarniciones',
    },

    // Extras: se agregan manualmente al pedido cuando aplican.
    { nombre: 'Tupper', precio: '1.00', categoria: 'extras' },
    { nombre: 'Bolsa', precio: '0.50', categoria: 'extras' },
  ];

  for (const p of platos) {
    const [existing] = await db
      .select()
      .from(schema.platoCarta)
      .where(eq(schema.platoCarta.nombre, p.nombre));
    if (existing) {
      console.log(`✓ Plato ya existe: ${p.nombre}`);
      continue;
    }
    const catInfo = catMap[p.categoria];
    if (!catInfo) {
      console.warn(`⚠️ Categoría no encontrada para ${p.nombre}: ${p.categoria}`);
      continue;
    }

    const [plato] = await db
      .insert(schema.platoCarta)
      .values({
        nombre: p.nombre,
        precio: p.precio,
        categoriaId: catInfo.id,
      })
      .returning();
    console.log(`✓ Plato creado: ${p.nombre} — S/${p.precio}`);

    if (p.receta) {
      const insumo = insumoMap[p.receta.insumo];
      if (insumo) {
        await db.insert(schema.recetaPlato).values({
          platoCartaId: plato.id,
          insumoId: insumo.id,
          cantidadConsumida: p.receta.cantidad,
        });
        console.log(`  └─ Receta: ${p.receta.cantidad}x ${p.receta.insumo}`);
      }
    }
  }

  // ─── Auto-sync disponible según stock del insumo ──────────────────────────
  console.log('\n→ Sincronizando disponibilidad por stock…');

  const todosLosPlatos = await db
    .select({
      plato: schema.platoCarta,
      categoria: schema.categoriaCarta,
    })
    .from(schema.platoCarta)
    .leftJoin(
      schema.categoriaCarta,
      eq(schema.platoCarta.categoriaId, schema.categoriaCarta.id),
    )
    .where(eq(schema.platoCarta.activo, true));
  const todasLasRecetas = await db.select().from(schema.recetaPlato);
  const todosLosInsumos = await db.select().from(schema.insumo);

  const insumoStockMap = new Map(
    todosLosInsumos.map((i) => [i.id, i.stockActual ?? 0]),
  );

  const recetaPorPlato = new Map<string, string>(); // platoId → insumoId
  for (const r of todasLasRecetas) {
    if (!recetaPorPlato.has(r.platoCartaId)) {
      recetaPorPlato.set(r.platoCartaId, r.insumoId);
    }
  }

  let sinStock = 0;
  let conStock = 0;

  for (const { plato, categoria } of todosLosPlatos) {
    if (!categoria?.descuentaStock) continue;

    const insumoId = recetaPorPlato.get(plato.id);
    if (!insumoId) continue;

    const stock = insumoStockMap.get(insumoId) ?? 0;
    const debeEstarDisponible = stock > 0;

    if (plato.disponible !== debeEstarDisponible) {
      await db
        .update(schema.platoCarta)
        .set({ disponible: debeEstarDisponible })
        .where(eq(schema.platoCarta.id, plato.id));
      const estado = debeEstarDisponible ? 'disponible ✓' : 'sin stock ✗';
      console.log(`  ${estado}: ${plato.nombre} (stock insumo: ${stock})`);
    }

    debeEstarDisponible ? conStock++ : sinStock++;
  }

  console.log(`  → ${conStock} disponibles, ${sinStock} sin stock`);

  // ─── Mesas ────────────────────────────────────────────────────────────────

  const totalMesas = 10;
  const [existingMesa] = await db.select().from(schema.mesa).limit(1);
  if (existingMesa) {
    console.log(`\n✓ Mesas ya existen (${totalMesas} esperadas)`);
  } else {
    for (let i = 1; i <= totalMesas; i++) {
      await db.insert(schema.mesa).values({ numero: i, capacidad: 4 });
    }
    console.log(`\n✓ ${totalMesas} mesas creadas`);
  }

  await pool.end();
  console.log('\n✓ Seed de catálogo completado');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
