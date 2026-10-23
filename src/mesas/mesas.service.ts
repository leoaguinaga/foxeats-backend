import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { ZonasService } from './zonas.service';

function esNumeroDuplicado(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

type TipoMesa = 'mesa' | 'barra';

function tipoValido(t: unknown): TipoMesa {
  return t === 'barra' ? 'barra' : 'mesa';
}

function entero(valor: unknown, campo: string, min: number, max: number) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${campo} debe ser un entero entre ${min} y ${max}`);
  }
  return n;
}

@Injectable()
export class MesasService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private zonas: ZonasService,
  ) {}

  async findAll() {
    return this.db.select().from(schema.mesa).orderBy(schema.mesa.numero);
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.mesa)
      .where(eq(schema.mesa.id, id));
    if (!row) throw new NotFoundException('Mesa no encontrada');
    return row;
  }

  private async zonaValida(zonaId?: string | null) {
    if (zonaId) {
      if (!(await this.zonas.existe(zonaId))) throw new BadRequestException('Zona no encontrada');
      return zonaId;
    }
    return (await this.zonas.zonaPorDefecto())?.id ?? null;
  }

  async create(data: { numero: number; capacidad?: number; zonaId?: string; tipo?: TipoMesa }) {
    const numero = entero(data.numero, 'El número', 1, 9999);
    const capacidad = data.capacidad === undefined ? undefined : entero(data.capacidad, 'La capacidad', 1, 50);
    const zonaId = await this.zonaValida(data.zonaId);
    try {
      const [row] = await this.db
        .insert(schema.mesa)
        .values({ numero, capacidad, zonaId, tipo: tipoValido(data.tipo) })
        .returning();
      return row;
    } catch (err) {
      if (esNumeroDuplicado(err)) throw new ConflictException(`La mesa ${numero} ya existe`);
      throw err;
    }
  }

  /** Crea las mesas desde..hasta en una zona; omite los números ya usados. */
  async createRango(data: { desde: number; hasta: number; capacidad?: number; zonaId?: string; tipo?: TipoMesa }) {
    const desde = entero(data.desde, 'Desde', 1, 9999);
    const hasta = entero(data.hasta, 'Hasta', 1, 9999);
    if (hasta < desde) throw new BadRequestException('«Hasta» debe ser mayor o igual que «Desde»');
    if (hasta - desde + 1 > 100) throw new BadRequestException('Máximo 100 mesas por vez');
    const capacidad = entero(data.capacidad ?? 4, 'La capacidad', 1, 50);
    const zonaId = await this.zonaValida(data.zonaId);

    const usados = new Set(
      (await this.db.select({ numero: schema.mesa.numero }).from(schema.mesa)).map((m) => m.numero),
    );
    const nuevos: number[] = [];
    const omitidos: number[] = [];
    for (let n = desde; n <= hasta; n++) (usados.has(n) ? omitidos : nuevos).push(n);

    const creadas = nuevos.length
      ? await this.db
          .insert(schema.mesa)
          .values(nuevos.map((numero) => ({ numero, capacidad, zonaId, tipo: tipoValido(data.tipo) })))
          .returning()
      : [];
    return { creadas, omitidos };
  }

  async update(
    id: string,
    data: Partial<{
      numero: number;
      capacidad: number;
      estado: 'libre' | 'ocupada';
      filaPosicion: number | null;
      colPosicion: number | null;
      zonaId: string;
      ancho: number;
      tipo: TipoMesa;
    }>,
  ) {
    const actual = await this.findById(id);
    const set: Partial<typeof schema.mesa.$inferInsert> = { updatedAt: new Date() };
    if (data.numero !== undefined) set.numero = entero(data.numero, 'El número', 1, 9999);
    if (data.capacidad !== undefined) set.capacidad = entero(data.capacidad, 'La capacidad', 1, 50);
    if (data.estado === 'libre' || data.estado === 'ocupada') set.estado = data.estado;
    if (data.filaPosicion !== undefined) set.filaPosicion = data.filaPosicion;
    if (data.colPosicion !== undefined) set.colPosicion = data.colPosicion;
    if (data.ancho !== undefined) set.ancho = data.ancho === 2 ? 2 : 1;
    if (data.tipo !== undefined) {
      set.tipo = tipoValido(data.tipo);
      if (set.tipo === 'barra') set.ancho = 1; // un taburete ocupa una celda
    }
    if (data.zonaId !== undefined && data.zonaId !== actual.zonaId) {
      set.zonaId = await this.zonaValida(data.zonaId);
      // Al cambiar de zona la mesa llega «sin ubicar» a su nuevo plano
      set.filaPosicion = null;
      set.colPosicion = null;
    }
    try {
      const [row] = await this.db
        .update(schema.mesa)
        .set(set)
        .where(eq(schema.mesa.id, id))
        .returning();
      if (!row) throw new NotFoundException('Mesa no encontrada');
      return row;
    } catch (err) {
      if (esNumeroDuplicado(err)) throw new ConflictException(`La mesa ${set.numero} ya existe`);
      throw err;
    }
  }

  async actualizarLayout(
    posiciones: Array<{
      id: string;
      filaPosicion: number | null;
      colPosicion: number | null;
    }>,
  ) {
    for (const p of posiciones) {
      await this.db
        .update(schema.mesa)
        .set({
          filaPosicion: p.filaPosicion,
          colPosicion: p.colPosicion,
          updatedAt: new Date(),
        })
        .where(eq(schema.mesa.id, p.id));
    }
    return { ok: true, actualizadas: posiciones.length };
  }

  async delete(id: string) {
    const [row] = await this.db
      .delete(schema.mesa)
      .where(eq(schema.mesa.id, id))
      .returning();
    if (!row) throw new NotFoundException('Mesa no encontrada');
    return row;
  }
}
