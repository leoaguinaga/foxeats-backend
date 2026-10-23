import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { StockService } from '../stock/stock.service';

type PlatoConCategoria = typeof schema.platoCarta.$inferSelect & {
  categoria: typeof schema.categoriaCarta.$inferSelect;
};

// Añade stockActual a los platos A/B a través de su receta + insumo
async function enrichWithStock(
  platos: PlatoConCategoria[],
  db: NodePgDatabase<typeof schema>,
) {
  if (!platos.length)
    return platos.map((p) => ({
      ...p,
      stockActual: null as number | null,
      nombreUnidadMinima: null as string | null,
      quedan: null as number | null,
      stockMinimo: null as number | null,
      insumoId: null as string | null,
      cantidadConsumida: null as number | null,
    }));

  const todasRecetas = await db
    .select({
      platoCartaId: schema.recetaPlato.platoCartaId,
      cantidadConsumida: schema.recetaPlato.cantidadConsumida,
      stockActual: schema.insumo.stockActual,
      nombreUnidadMinima: schema.insumo.nombreUnidadMinima,
      minimo: schema.insumo.minimo,
      insumoId: schema.recetaPlato.insumoId,
    })
    .from(schema.recetaPlato)
    .innerJoin(
      schema.insumo,
      eq(schema.recetaPlato.insumoId, schema.insumo.id),
    );

  const recetaMap = new Map(todasRecetas.map((r) => [r.platoCartaId, r]));

  // Tener receta es lo que hace que un plato descuente y muestre «quedan N».
  return platos.map((p) => {
    const receta = recetaMap.get(p.id);
    return {
      ...p,
      stockActual: receta ? receta.stockActual : null,
      nombreUnidadMinima: receta ? receta.nombreUnidadMinima : null,
      quedan: receta
        ? Math.floor(Math.max(receta.stockActual, 0) / receta.cantidadConsumida)
        : null,
      stockMinimo: receta ? receta.minimo : null,
      insumoId: receta ? receta.insumoId : null,
      cantidadConsumida: receta ? receta.cantidadConsumida : null,
    };
  });
}

@Injectable()
export class CatalogoService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private stock: StockService,
  ) {}

  // ─── Categorías ───

  async findAllCategorias() {
    return this.db
      .select()
      .from(schema.categoriaCarta)
      .where(eq(schema.categoriaCarta.activo, true))
      .orderBy(schema.categoriaCarta.orden);
  }

  async createCategoria(data: {
    nombre: string;
    slug?: string;
    descuentaStock?: boolean;
    esParaCocina?: boolean;
    orden?: number;
  }) {
    const slug =
      data.slug?.trim() ||
      data.nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const [row] = await this.db
      .insert(schema.categoriaCarta)
      .values({
        ...data,
        slug,
      })
      .returning();
    return row;
  }

  async updateCategoria(
    id: string,
    data: Partial<{
      nombre: string;
      slug: string;
      descuentaStock: boolean;
      esParaCocina: boolean;
      orden: number;
      activo: boolean;
    }>,
  ) {
    const [row] = await this.db
      .update(schema.categoriaCarta)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.categoriaCarta.id, id))
      .returning();
    if (!row) throw new NotFoundException('Categoría no encontrada');
    return row;
  }

  // ─── Insumos ───

  async findAllInsumos() {
    return this.db
      .select()
      .from(schema.insumo)
      .where(eq(schema.insumo.activo, true));
  }

  async findInsumoById(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.insumo)
      .where(eq(schema.insumo.id, id));
    if (!row) throw new NotFoundException('Insumo no encontrado');
    return row;
  }

  async createInsumo(
    data: {
      nombre: string;
      unidadesPorUnidadDeCompra?: number;
      nombreUnidadMinima?: string;
      nombreUnidadCompra?: string;
      minimo?: number;
      stockActual?: number;
    },
    usuarioId: string | null = null,
  ) {
    const { stockActual = 0, ...resto } = data;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.insumo)
        .values({ ...resto, stockActual: Math.max(0, stockActual) })
        .returning();
      await this.stock.registrarStockInicial(
        tx,
        row.id,
        row.stockActual,
        usuarioId,
      );
      return row;
    });
  }

  // El stock no se edita aquí: se cambia con merma, corrección, compra o conteo.
  async updateInsumo(
    id: string,
    data: Partial<{
      nombre: string;
      unidadesPorUnidadDeCompra: number;
      nombreUnidadMinima: string;
      nombreUnidadCompra: string;
      minimo: number;
      activo: boolean;
    }>,
  ) {
    const permitido = {
      nombre: data.nombre,
      unidadesPorUnidadDeCompra: data.unidadesPorUnidadDeCompra,
      nombreUnidadMinima: data.nombreUnidadMinima,
      nombreUnidadCompra: data.nombreUnidadCompra,
      minimo: data.minimo,
      activo: data.activo,
    };
    const set = Object.fromEntries(
      Object.entries(permitido).filter(([, v]) => v !== undefined),
    );
    const [row] = await this.db
      .update(schema.insumo)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(schema.insumo.id, id))
      .returning();
    if (!row) throw new NotFoundException('Insumo no encontrado');
    return row;
  }

  // ─── Platos ───

  async findAllPlatos(incluirRetirados = false) {
    const rows = await this.db
      .select({
        plato: schema.platoCarta,
        categoria: schema.categoriaCarta,
      })
      .from(schema.platoCarta)
      .leftJoin(
        schema.categoriaCarta,
        eq(schema.platoCarta.categoriaId, schema.categoriaCarta.id),
      )
      .where(incluirRetirados ? undefined : eq(schema.platoCarta.activo, true))
      .orderBy(asc(schema.platoCarta.createdAt), asc(schema.platoCarta.nombre));

    const platosFormatted = rows.map(({ plato, categoria }) => ({
      ...plato,
      categoria: categoria!,
    }));

    return enrichWithStock(platosFormatted, this.db);
  }

  // Devuelve TODOS los platos activos con stock (disponible o no) para que el mesero vea el estado real
  async findPlatosDisponibles() {
    return this.findAllPlatos();
  }

  async findPlatoById(id: string) {
    const [row] = await this.db
      .select({
        plato: schema.platoCarta,
        categoria: schema.categoriaCarta,
      })
      .from(schema.platoCarta)
      .leftJoin(
        schema.categoriaCarta,
        eq(schema.platoCarta.categoriaId, schema.categoriaCarta.id),
      )
      .where(eq(schema.platoCarta.id, id));

    if (!row || !row.plato) throw new NotFoundException('Plato no encontrado');
    return {
      ...row.plato,
      categoria: row.categoria!,
    };
  }

  async createPlato(data: {
    nombre: string;
    precio: string;
    categoriaId: string;
    descripcion?: string;
  }) {
    const [row] = await this.db
      .insert(schema.platoCarta)
      .values(data)
      .returning();
    return row;
  }

  async createPlatosBulk(data: {
    categoriaId: string;
    platos: Array<{ nombre: string; precio: string; descripcion?: string }>;
  }) {
    if (!data.platos?.length) {
      throw new Error('Debe proveer al menos un plato.');
    }
    const values = data.platos.map((p) => ({
      nombre: p.nombre,
      precio: p.precio,
      categoriaId: data.categoriaId,
      descripcion: p.descripcion || null,
    }));
    return this.db.insert(schema.platoCarta).values(values).returning();
  }

  async updatePlato(
    id: string,
    data: {
      nombre?: string;
      precio?: string;
      descripcion?: string;
      categoriaId?: string;
      disponible?: boolean;
      activo?: boolean;
    },
  ) {
    const [row] = await this.db
      .update(schema.platoCarta)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.platoCarta.id, id))
      .returning();
    if (!row) throw new NotFoundException('Plato no encontrado');
    return row;
  }

  // ─── Recetas ───

  async findRecetasByPlato(platoCartaId: string) {
    return this.db
      .select()
      .from(schema.recetaPlato)
      .where(eq(schema.recetaPlato.platoCartaId, platoCartaId));
  }

  // Un plato descuenta de UN insumo: vincular de nuevo reemplaza el vínculo.
  async createReceta(data: {
    platoCartaId: string;
    insumoId: string;
    cantidadConsumida: number;
  }) {
    if (!Number.isInteger(data.cantidadConsumida) || data.cantidadConsumida < 1)
      throw new BadRequestException('La cantidad debe ser un entero mayor a 0');
    return this.db.transaction(async (tx) => {
      await tx
        .delete(schema.recetaPlato)
        .where(eq(schema.recetaPlato.platoCartaId, data.platoCartaId));
      const [row] = await tx
        .insert(schema.recetaPlato)
        .values(data)
        .returning();
      await this.stock.recalcularDisponibilidad(tx, [data.insumoId]);
      return row;
    });
  }

  async deleteReceta(id: string) {
    const [row] = await this.db
      .delete(schema.recetaPlato)
      .where(eq(schema.recetaPlato.id, id))
      .returning();
    if (!row) throw new NotFoundException('Receta no encontrada');
    // Sin receta la disponibilidad vuelve a ser manual: no dejarlo apagado por stock.
    await this.db
      .update(schema.platoCarta)
      .set({ disponible: true, updatedAt: new Date() })
      .where(eq(schema.platoCarta.id, row.platoCartaId));
    return row;
  }
}
