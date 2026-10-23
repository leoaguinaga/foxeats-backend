import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../db/db.module';
import * as schema from '../db/schema';

type Db = NodePgDatabase<typeof schema>;
// Una transacción de drizzle comparte la API de consulta con la base.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | Tx;

export type TipoMovimiento =
  (typeof schema.tipoMovimientoStockEnum.enumValues)[number];

interface Origen {
  usuarioId?: string | null;
  pedidoId?: string | null;
  platoCartaId?: string | null;
  compraId?: string | null;
  conteoId?: string | null;
  motivo?: string | null;
  nota?: string | null;
}

// Lima no tiene horario de verano; el servidor puede correr en UTC (Docker).
const OFFSET_LIMA_H = 5;
const HORA_MS = 3_600_000;

function inicioDiaLima(ahora = new Date()) {
  const l = new Date(ahora.getTime() - OFFSET_LIMA_H * HORA_MS);
  return new Date(`${l.toISOString().slice(0, 10)}T00:00:00-05:00`);
}

export const MOTIVOS_MERMA = [
  'Se malogró',
  'Se cayó o rompió',
  'Cortesía',
  'Consumo del personal',
  'Otro',
];

@Injectable()
export class StockService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StockService.name);
  constructor(@Inject(DRIZZLE) private db: Db) {}

  async onApplicationBootstrap() {
    try {
      await this.recalcularDisponibilidad(this.db);
    } catch (err) {
      this.logger.warn(`Recalcular disponibilidad falló al iniciar: ${err}`);
    }
  }

  // ─── Núcleo: aplicar un cambio y dejarlo escrito ──────────────────────────

  /**
   * Suma `delta` (con signo) al stock del insumo y registra el movimiento con
   * el saldo resultante. Si `permitirNegativo` es false y el stock no alcanza,
   * no cambia nada y lanza «Solo quedan N».
   */
  private async aplicar(
    db: DbOrTx,
    insumoId: string,
    delta: number,
    tipo: TipoMovimiento,
    origen: Origen,
    opciones: { exigirStock?: boolean; etiqueta?: string } = {},
  ) {
    const ahora = new Date();
    const [fila] = await db
      .update(schema.insumo)
      .set({
        stockActual: sql`${schema.insumo.stockActual} + ${delta}`,
        updatedAt: ahora,
      })
      .where(
        opciones.exigirStock && delta < 0
          ? and(
              eq(schema.insumo.id, insumoId),
              gte(schema.insumo.stockActual, -delta),
            )
          : eq(schema.insumo.id, insumoId),
      )
      .returning({ stockActual: schema.insumo.stockActual });

    if (!fila) {
      const [ins] = await db
        .select({
          nombre: schema.insumo.nombre,
          stockActual: schema.insumo.stockActual,
          unidad: schema.insumo.nombreUnidadMinima,
        })
        .from(schema.insumo)
        .where(eq(schema.insumo.id, insumoId));
      if (!ins) throw new NotFoundException('Insumo no encontrado');
      const quedan = Math.max(ins.stockActual, 0);
      const resto = `solo quedan ${quedan} ${ins.unidad}${quedan === 1 ? '' : 's'}`;
      throw new BadRequestException(
        opciones.etiqueta
          ? `«${opciones.etiqueta}» no alcanza: de ${ins.nombre} ${resto}`
          : `${ins.nombre}: ${resto}`,
      );
    }

    await db.insert(schema.movimientoStock).values({
      insumoId,
      tipo,
      cantidad: delta,
      saldo: fila.stockActual,
      usuarioId: origen.usuarioId ?? null,
      pedidoId: origen.pedidoId ?? null,
      platoCartaId: origen.platoCartaId ?? null,
      compraId: origen.compraId ?? null,
      conteoId: origen.conteoId ?? null,
      motivo: origen.motivo ?? null,
      nota: origen.nota ?? null,
      createdAt: ahora,
    });

    return fila.stockActual;
  }

  /**
   * Un plato está disponible cuando alcanza para al menos uno según todos sus
   * insumos. Los platos sin receta no se tocan: su disponibilidad es manual.
   * Sin `insumoIds` recalcula todos.
   */
  async recalcularDisponibilidad(db: DbOrTx, insumoIds?: string[]) {
    if (insumoIds && !insumoIds.length) return;

    const filtro = insumoIds
      ? inArray(schema.recetaPlato.insumoId, insumoIds)
      : undefined;
    const tocados = await db
      .select({ id: schema.recetaPlato.platoCartaId })
      .from(schema.recetaPlato)
      .where(filtro);
    const platoIds = [...new Set(tocados.map((t) => t.id))];
    if (!platoIds.length) return;

    const filas = await db
      .select({
        platoId: schema.recetaPlato.platoCartaId,
        consumo: schema.recetaPlato.cantidadConsumida,
        stock: schema.insumo.stockActual,
      })
      .from(schema.recetaPlato)
      .innerJoin(
        schema.insumo,
        eq(schema.recetaPlato.insumoId, schema.insumo.id),
      )
      .where(inArray(schema.recetaPlato.platoCartaId, platoIds));

    const alcanza = new Map<string, boolean>();
    for (const f of filas) {
      const ok = f.stock >= f.consumo;
      alcanza.set(f.platoId, (alcanza.get(f.platoId) ?? true) && ok);
    }
    const habilitar = [...alcanza].filter(([, v]) => v).map(([k]) => k);
    const apagar = [...alcanza].filter(([, v]) => !v).map(([k]) => k);

    if (habilitar.length)
      await db
        .update(schema.platoCarta)
        .set({ disponible: true, updatedAt: new Date() })
        .where(
          and(
            inArray(schema.platoCarta.id, habilitar),
            eq(schema.platoCarta.disponible, false),
          ),
        );
    if (apagar.length)
      await db
        .update(schema.platoCarta)
        .set({ disponible: false, updatedAt: new Date() })
        .where(
          and(
            inArray(schema.platoCarta.id, apagar),
            eq(schema.platoCarta.disponible, true),
          ),
        );
  }

  // ─── Ventas y anulaciones (las llaman Operación y Caja dentro de su tx) ───

  /**
   * Descuenta lo que consumen los ítems recién creados. Todo plato con receta
   * descuenta. Si algún insumo no alcanza, lanza y la transacción completa se
   * revierte (el pedido no se crea).
   */
  async descontarVenta(
    tx: DbOrTx,
    items: Array<{ platoCartaId: string; cantidad: number }>,
    origen: { pedidoId: string; usuarioId: string | null },
  ) {
    if (!items.length) return;
    const platoIds = [...new Set(items.map((i) => i.platoCartaId))];
    const recetas = await tx
      .select({
        platoId: schema.recetaPlato.platoCartaId,
        insumoId: schema.recetaPlato.insumoId,
        consumo: schema.recetaPlato.cantidadConsumida,
        plato: schema.platoCarta.nombre,
      })
      .from(schema.recetaPlato)
      .innerJoin(
        schema.platoCarta,
        eq(schema.recetaPlato.platoCartaId, schema.platoCarta.id),
      )
      .where(inArray(schema.recetaPlato.platoCartaId, platoIds));
    if (!recetas.length) return;

    // Orden estable por insumo: dos ventas simultáneas no se bloquean entre sí.
    const lineas = items
      .flatMap((it) =>
        recetas
          .filter((r) => r.platoId === it.platoCartaId)
          .map((r) => ({
            insumoId: r.insumoId,
            platoId: it.platoCartaId,
            plato: r.plato,
            delta: -(r.consumo * it.cantidad),
          })),
      )
      .sort((a, b) => a.insumoId.localeCompare(b.insumoId));

    for (const l of lineas) {
      await this.aplicar(
        tx,
        l.insumoId,
        l.delta,
        'venta',
        {
          usuarioId: origen.usuarioId,
          pedidoId: origen.pedidoId,
          platoCartaId: l.platoId,
          nota: l.plato,
        },
        { exigirStock: true, etiqueta: l.plato },
      );
    }
    await this.recalcularDisponibilidad(tx, [
      ...new Set(lineas.map((l) => l.insumoId)),
    ]);
  }

  /** Devuelve al stock lo que había consumido un ítem que se anula. */
  async restaurarItem(
    tx: DbOrTx,
    item: { platoCartaId: string; cantidad: number; pedidoId: string },
    usuarioId: string | null,
  ) {
    const recetas = await tx
      .select({
        insumoId: schema.recetaPlato.insumoId,
        consumo: schema.recetaPlato.cantidadConsumida,
        plato: schema.platoCarta.nombre,
      })
      .from(schema.recetaPlato)
      .innerJoin(
        schema.platoCarta,
        eq(schema.recetaPlato.platoCartaId, schema.platoCarta.id),
      )
      .where(eq(schema.recetaPlato.platoCartaId, item.platoCartaId));
    for (const r of recetas) {
      await this.aplicar(tx, r.insumoId, r.consumo * item.cantidad, 'anulacion', {
        usuarioId,
        pedidoId: item.pedidoId,
        platoCartaId: item.platoCartaId,
        nota: r.plato,
      });
    }
    await this.recalcularDisponibilidad(
      tx,
      recetas.map((r) => r.insumoId),
    );
  }

  // ─── Operaciones de administración / caja ─────────────────────────────────

  private entero(v: unknown, campo: string, min = 1) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min)
      throw new BadRequestException(
        min > 0
          ? `${campo} debe ser un entero mayor a 0`
          : `${campo} debe ser un entero válido`,
      );
    return n;
  }

  async registrarMerma(
    insumoId: string,
    cantidadIn: number,
    motivoIn: string,
    nota: string | undefined,
    usuarioId: string,
  ) {
    const cantidad = this.entero(cantidadIn, 'La cantidad');
    const motivo = motivoIn?.trim();
    if (!motivo) throw new BadRequestException('El motivo es obligatorio');
    return this.db.transaction(async (tx) => {
      const saldo = await this.aplicar(
        tx,
        insumoId,
        -cantidad,
        'merma',
        { usuarioId, motivo, nota: nota?.trim() || null },
        { exigirStock: true },
      );
      await this.recalcularDisponibilidad(tx, [insumoId]);
      return { stockActual: saldo };
    });
  }

  /** «Hay en realidad N»: fija el stock y deja la diferencia con su motivo. */
  async corregir(
    insumoId: string,
    stockRealIn: number,
    motivoIn: string,
    usuarioId: string,
  ) {
    const stockReal = this.entero(stockRealIn, 'El stock real', 0);
    const motivo = motivoIn?.trim();
    if (!motivo) throw new BadRequestException('El motivo es obligatorio');
    return this.db.transaction(async (tx) => {
      const [ins] = await tx
        .select({ stock: schema.insumo.stockActual })
        .from(schema.insumo)
        .where(eq(schema.insumo.id, insumoId))
        .for('update');
      if (!ins) throw new NotFoundException('Insumo no encontrado');
      const delta = stockReal - ins.stock;
      if (delta === 0) return { stockActual: ins.stock };
      const saldo = await this.aplicar(tx, insumoId, delta, 'correccion', {
        usuarioId,
        motivo,
      });
      await this.recalcularDisponibilidad(tx, [insumoId]);
      return { stockActual: saldo };
    });
  }

  /** Stock inicial al crear un insumo: queda como primer movimiento. */
  async registrarStockInicial(
    tx: DbOrTx,
    insumoId: string,
    cantidad: number,
    usuarioId: string | null,
  ) {
    if (cantidad <= 0) return;
    await tx.insert(schema.movimientoStock).values({
      insumoId,
      tipo: 'correccion',
      cantidad,
      saldo: cantidad,
      usuarioId,
      motivo: 'Stock inicial',
      createdAt: new Date(),
    });
  }

  /** Recibir compra: cantidades en la unidad en que llegan (pollos, cajas…). */
  async registrarCompra(
    items: Array<{ insumoId: string; cantidad: number }>,
    proveedor: string | undefined,
    usuarioId: string,
  ) {
    const validos = (items ?? []).filter((i) => i && Number(i.cantidad) > 0);
    if (!validos.length)
      throw new BadRequestException('Ingresa al menos un insumo');
    const ids = validos.map((i) => i.insumoId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Hay insumos repetidos en la compra');

    return this.db.transaction(async (tx) => {
      const insumos = await tx
        .select()
        .from(schema.insumo)
        .where(inArray(schema.insumo.id, ids));
      const map = new Map(insumos.map((i) => [i.id, i]));

      const [compra] = await tx
        .insert(schema.compraStock)
        .values({
          usuarioId,
          proveedor: proveedor?.trim() || null,
          createdAt: new Date(),
        })
        .returning();

      for (const it of validos) {
        const ins = map.get(it.insumoId);
        if (!ins) throw new NotFoundException('Insumo no encontrado');
        const cantidad = this.entero(it.cantidad, `Cantidad de ${ins.nombre}`);
        await this.aplicar(
          tx,
          ins.id,
          cantidad * ins.unidadesPorUnidadDeCompra,
          'compra',
          {
            usuarioId,
            compraId: compra.id,
            motivo: proveedor?.trim() || null,
            nota: `${cantidad} ${ins.nombreUnidadCompra}${cantidad === 1 ? '' : 's'}`,
          },
        );
      }
      await this.recalcularDisponibilidad(tx, ids);
      return { compraId: compra.id, insumos: validos.length };
    });
  }

  /**
   * Conteo físico. Compara lo contado con el sistema; cada diferencia exige su
   * motivo. Lo que no se cuenta se queda como está.
   */
  async registrarConteo(
    items: Array<{ insumoId: string; contado: number; motivo?: string }>,
    usuarioId: string,
  ) {
    if (!items?.length)
      throw new BadRequestException('No hay insumos contados');
    const ids = items.map((i) => i.insumoId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Hay insumos repetidos en el conteo');

    return this.db.transaction(async (tx) => {
      const actuales = await tx
        .select()
        .from(schema.insumo)
        .where(inArray(schema.insumo.id, ids))
        .orderBy(asc(schema.insumo.id))
        .for('update');
      const map = new Map(actuales.map((i) => [i.id, i]));

      const plan = items.map((it) => {
        const ins = map.get(it.insumoId);
        if (!ins) throw new NotFoundException('Insumo no encontrado');
        const contado = this.entero(it.contado, `Lo contado de ${ins.nombre}`, 0);
        const diff = contado - ins.stockActual;
        const motivo = it.motivo?.trim();
        if (diff !== 0 && !motivo)
          throw new BadRequestException(
            `Falta el motivo de la diferencia en ${ins.nombre}`,
          );
        return { ins, diff, motivo };
      });
      const conDiferencia = plan.filter((p) => p.diff !== 0);

      const [conteo] = await tx
        .insert(schema.conteoStock)
        .values({
          usuarioId,
          insumosContados: plan.length,
          diferencias: conDiferencia.length,
          createdAt: new Date(),
        })
        .returning();

      for (const p of conDiferencia) {
        await this.aplicar(tx, p.ins.id, p.diff, 'conteo', {
          usuarioId,
          conteoId: conteo.id,
          motivo: p.motivo,
        });
      }
      await this.recalcularDisponibilidad(
        tx,
        conDiferencia.map((p) => p.ins.id),
      );
      return {
        conteoId: conteo.id,
        contados: plan.length,
        diferencias: conDiferencia.length,
      };
    });
  }

  // ─── Lecturas ─────────────────────────────────────────────────────────────

  async listar() {
    const insumos = await this.db
      .select()
      .from(schema.insumo)
      .where(eq(schema.insumo.activo, true))
      .orderBy(asc(schema.insumo.nombre));

    const recetas = await this.db
      .select({
        insumoId: schema.recetaPlato.insumoId,
        recetaId: schema.recetaPlato.id,
        consumo: schema.recetaPlato.cantidadConsumida,
        platoId: schema.platoCarta.id,
        nombre: schema.platoCarta.nombre,
        disponible: schema.platoCarta.disponible,
        activo: schema.platoCarta.activo,
        categoria: schema.categoriaCarta.nombre,
      })
      .from(schema.recetaPlato)
      .innerJoin(
        schema.platoCarta,
        eq(schema.recetaPlato.platoCartaId, schema.platoCarta.id),
      )
      .leftJoin(
        schema.categoriaCarta,
        eq(schema.platoCarta.categoriaId, schema.categoriaCarta.id),
      );

    const hoy = inicioDiaLima();
    const ultimaHora = new Date(Date.now() - HORA_MS);
    const flujo = await this.db
      .select({
        insumoId: schema.movimientoStock.insumoId,
        vendido: sql<number>`coalesce(sum(case when ${schema.movimientoStock.tipo} = 'venta' then -${schema.movimientoStock.cantidad} when ${schema.movimientoStock.tipo} = 'anulacion' then -${schema.movimientoStock.cantidad} else 0 end), 0)::int`,
        comprado: sql<number>`coalesce(sum(case when ${schema.movimientoStock.tipo} = 'compra' then ${schema.movimientoStock.cantidad} else 0 end), 0)::int`,
        ritmo: sql<number>`coalesce(sum(case when ${schema.movimientoStock.tipo} in ('venta','anulacion') and ${schema.movimientoStock.createdAt} >= ${ultimaHora} then -${schema.movimientoStock.cantidad} else 0 end), 0)::int`,
      })
      .from(schema.movimientoStock)
      .where(gte(schema.movimientoStock.createdAt, hoy))
      .groupBy(schema.movimientoStock.insumoId);
    const flujoMap = new Map(flujo.map((f) => [f.insumoId, f]));

    return insumos.map((ins) => {
      const propios = recetas.filter((r) => r.insumoId === ins.id && r.activo);
      const f = flujoMap.get(ins.id);
      return {
        ...ins,
        grupo: propios[0]?.categoria ?? 'Sin plato',
        vendidoHoy: f?.vendido ?? 0,
        compradoHoy: f?.comprado ?? 0,
        ritmoHora: f?.ritmo ?? 0,
        platosAsociados: propios.map((r) => ({
          id: r.platoId,
          recetaId: r.recetaId,
          nombre: r.nombre,
          disponible: r.disponible,
          cantidadConsumida: r.consumo,
          quedan: Math.floor(Math.max(ins.stockActual, 0) / r.consumo),
        })),
      };
    });
  }

  async movimientos(insumoId: string, limite = 60) {
    return this.db
      .select({
        id: schema.movimientoStock.id,
        tipo: schema.movimientoStock.tipo,
        cantidad: schema.movimientoStock.cantidad,
        saldo: schema.movimientoStock.saldo,
        motivo: schema.movimientoStock.motivo,
        nota: schema.movimientoStock.nota,
        usuario: schema.user.name,
        createdAt: schema.movimientoStock.createdAt,
      })
      .from(schema.movimientoStock)
      .leftJoin(
        schema.user,
        eq(schema.movimientoStock.usuarioId, schema.user.id),
      )
      .where(eq(schema.movimientoStock.insumoId, insumoId))
      .orderBy(desc(schema.movimientoStock.createdAt))
      .limit(Math.min(Math.max(limite, 1), 200));
  }

  async ultimoConteo() {
    const [fila] = await this.db
      .select({
        id: schema.conteoStock.id,
        createdAt: schema.conteoStock.createdAt,
        contados: schema.conteoStock.insumosContados,
        diferencias: schema.conteoStock.diferencias,
        usuario: schema.user.name,
      })
      .from(schema.conteoStock)
      .leftJoin(schema.user, eq(schema.conteoStock.usuarioId, schema.user.id))
      .orderBy(desc(schema.conteoStock.createdAt))
      .limit(1);
    return fila ?? null;
  }

  /** Orden de la hoja de conteo (orden del almacén). */
  async ordenarConteo(ids: string[]) {
    await this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx
          .update(schema.insumo)
          .set({ ordenConteo: i + 1, updatedAt: new Date() })
          .where(eq(schema.insumo.id, id));
      }
    });
    return { ok: true };
  }
}
