import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import type { ReferenciaPlano } from '../db/schema';

type ModoZona = 'plano' | 'numeros';

const MAX_DIM = 30;

function dimension(valor: unknown, campo: string): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DIM) {
    throw new BadRequestException(`${campo} debe ser un entero entre 1 y ${MAX_DIM}`);
  }
  return n;
}

function limpiarReferencias(refs: unknown): ReferenciaPlano[] {
  if (!Array.isArray(refs)) throw new BadRequestException('Referencias inválidas');
  return refs.map((r: Partial<ReferenciaPlano>) => {
    const etiqueta = String(r.etiqueta ?? '').trim().slice(0, 24);
    if (!etiqueta) throw new BadRequestException('Cada referencia necesita un nombre');
    return {
      id: String(r.id ?? crypto.randomUUID()),
      etiqueta,
      fila: Math.max(0, Math.trunc(Number(r.fila) || 0)),
      col: Math.max(0, Math.trunc(Number(r.col) || 0)),
      ancho: Math.min(MAX_DIM, Math.max(1, Math.trunc(Number(r.ancho) || 1))),
      alto: Math.min(MAX_DIM, Math.max(1, Math.trunc(Number(r.alto) || 1))),
    };
  });
}

@Injectable()
export class ZonasService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  findAll() {
    return this.db
      .select()
      .from(schema.zona)
      .orderBy(asc(schema.zona.orden), asc(schema.zona.createdAt));
  }

  async create(data: { nombre?: string; modo?: ModoZona }) {
    const nombre = data.nombre?.trim();
    if (!nombre) throw new BadRequestException('La zona necesita un nombre');
    const existentes = await this.findAll();
    const [row] = await this.db
      .insert(schema.zona)
      .values({
        nombre: nombre.slice(0, 40),
        modo: data.modo === 'plano' ? 'plano' : 'numeros',
        orden: existentes.length,
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    data: Partial<{ nombre: string; modo: ModoZona; filas: number; columnas: number }>,
  ) {
    const set: Partial<typeof schema.zona.$inferInsert> = { updatedAt: new Date() };
    if (data.nombre !== undefined) {
      const nombre = data.nombre.trim();
      if (!nombre) throw new BadRequestException('La zona necesita un nombre');
      set.nombre = nombre.slice(0, 40);
    }
    if (data.modo !== undefined) {
      if (data.modo !== 'plano' && data.modo !== 'numeros') {
        throw new BadRequestException('Modo inválido');
      }
      set.modo = data.modo;
    }
    if (data.filas !== undefined) set.filas = dimension(data.filas, 'Filas');
    if (data.columnas !== undefined) set.columnas = dimension(data.columnas, 'Columnas');

    const [row] = await this.db
      .update(schema.zona)
      .set(set)
      .where(eq(schema.zona.id, id))
      .returning();
    if (!row) throw new NotFoundException('Zona no encontrada');
    return row;
  }

  async reordenar(ids: string[]) {
    if (!Array.isArray(ids)) throw new BadRequestException('Orden inválido');
    await this.db.transaction(async (tx) => {
      for (const [orden, id] of ids.entries()) {
        await tx.update(schema.zona).set({ orden }).where(eq(schema.zona.id, id));
      }
    });
    return this.findAll();
  }

  async delete(id: string) {
    const zonas = await this.findAll();
    if (!zonas.some((z) => z.id === id)) throw new NotFoundException('Zona no encontrada');
    if (zonas.length <= 1) {
      throw new ConflictException('Debe quedar al menos una zona');
    }
    const mesas = await this.db
      .select({ id: schema.mesa.id })
      .from(schema.mesa)
      .where(eq(schema.mesa.zonaId, id));
    if (mesas.length > 0) {
      throw new ConflictException('Mueve o elimina sus mesas antes de eliminar la zona');
    }
    await this.db.delete(schema.zona).where(eq(schema.zona.id, id));
    return { ok: true };
  }

  /**
   * Guarda el plano de una zona en una sola operación: tamaño, referencias y
   * la posición/ancho de cada mesa de esa zona.
   */
  async guardarPlano(
    id: string,
    body: {
      filas: number;
      columnas: number;
      referencias: unknown;
      mesas: Array<{ id: string; filaPosicion: number | null; colPosicion: number | null; ancho?: number }>;
    },
  ) {
    const filas = dimension(body.filas, 'Filas');
    const columnas = dimension(body.columnas, 'Columnas');
    const referencias = limpiarReferencias(body.referencias ?? []);
    const mesas = Array.isArray(body.mesas) ? body.mesas : [];

    // Ocupación de celdas para detectar choques
    const ocupadas = new Set<string>();
    const marcar = (fila: number, col: number, ancho: number, alto: number, quien: string) => {
      if (fila + alto > filas || col + ancho > columnas) {
        throw new BadRequestException(`${quien} queda fuera del plano`);
      }
      for (let f = fila; f < fila + alto; f++) {
        for (let c = col; c < col + ancho; c++) {
          const k = `${f},${c}`;
          if (ocupadas.has(k)) throw new BadRequestException(`${quien} se superpone con otro elemento`);
          ocupadas.add(k);
        }
      }
    };
    for (const r of referencias) marcar(r.fila, r.col, r.ancho, r.alto, r.etiqueta);

    const ids = mesas.map((m) => m.id);
    const propias = ids.length
      ? await this.db
          .select({ id: schema.mesa.id, numero: schema.mesa.numero })
          .from(schema.mesa)
          .where(and(inArray(schema.mesa.id, ids), eq(schema.mesa.zonaId, id)))
      : [];
    const numeroPorId = new Map(propias.map((m) => [m.id, m.numero]));
    for (const m of mesas) {
      if (!numeroPorId.has(m.id)) throw new BadRequestException('Hay mesas que no pertenecen a esta zona');
      const ancho = m.ancho === 2 ? 2 : 1;
      if (m.filaPosicion !== null && m.colPosicion !== null) {
        marcar(m.filaPosicion, m.colPosicion, ancho, 1, `La mesa ${numeroPorId.get(m.id)}`);
      }
    }

    await this.db.transaction(async (tx) => {
      const [zona] = await tx
        .update(schema.zona)
        .set({ filas, columnas, referencias, updatedAt: new Date() })
        .where(eq(schema.zona.id, id))
        .returning();
      if (!zona) throw new NotFoundException('Zona no encontrada');
      for (const m of mesas) {
        await tx
          .update(schema.mesa)
          .set({
            filaPosicion: m.filaPosicion,
            colPosicion: m.colPosicion,
            ancho: m.ancho === 2 ? 2 : 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.mesa.id, m.id));
      }
    });
    return { ok: true };
  }

  /** Primera zona por orden; las mesas nuevas sin zona explícita caen aquí. */
  async zonaPorDefecto() {
    const [z] = await this.findAll();
    return z ?? null;
  }

  async existe(id: string) {
    const [z] = await this.db.select({ id: schema.zona.id }).from(schema.zona).where(eq(schema.zona.id, id));
    return !!z;
  }
}
