import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, inArray, sql, notInArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../db/db.module';
import { PRINT_SERVICE } from '../print/print.interface';
import type { PrintService } from '../print/print.interface';
import { PromocionesService } from '../promociones/promociones.service';
import { StockService } from '../stock/stock.service';
import * as schema from '../db/schema';

@Injectable()
export class OperacionService {
  private readonly logger = new Logger(OperacionService.name);
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @Inject(PRINT_SERVICE) private printer: PrintService,
    private promociones: PromocionesService,
    private stock: StockService,
  ) {}

  // ─── Monitor: rondas pendientes de todas las mesas ───────────────────────

  async getMonitor() {
    // Visitas abiertas
    const visitas = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.estado, 'abierta'));

    if (visitas.length === 0) return [];

    const visitaIds = visitas.map((v) => v.id);

    // Pedidos pendientes o en preparación dentro de visitas abiertas
    const pedidos = await this.db
      .select()
      .from(schema.pedido)
      .where(
        and(
          inArray(schema.pedido.visitaMesaId, visitaIds),
          inArray(schema.pedido.estado, [
            'pendiente',
            'en_preparacion',
            'listo',
          ]),
        ),
      );

    if (pedidos.length === 0) return [];

    const pedidoIds = pedidos.map((p) => p.id);
    const items = await this.db
      .select()
      .from(schema.itemPedido)
      .where(inArray(schema.itemPedido.pedidoId, pedidoIds));

    const mesas = await this.db.select().from(schema.mesa);
    const mesaMap = new Map(mesas.map((m) => [m.id, m]));
    const visitaMap = new Map(visitas.map((v) => [v.id, v]));

    return pedidos.map((p) => {
      const visita = visitaMap.get(p.visitaMesaId)!;
      const mesa = visita.mesaId ? mesaMap.get(visita.mesaId) : null;
      const minutosEspera = Math.floor(
        (Date.now() - new Date(p.fechaCreacion).getTime()) / 60000,
      );
      return {
        pedidoId: p.id,
        visitaId: p.visitaMesaId,
        mesaNumero: mesa?.numero ?? 0,
        estado: p.estado,
        fechaCreacion: p.fechaCreacion,
        minutosEspera,
        items: items
          .filter((i) => i.pedidoId === p.id)
          .map((i) => ({
            platoCartaId: i.platoCartaId,
            cantidad: i.cantidad,
            notas: i.notas,
          })),
      };
    });
  }

  // ─── Visita activa de una mesa ────────────────────────────────────────────

  async getVisitaActivaPorMesa(mesaId: string) {
    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(
        and(
          eq(schema.visitaMesa.mesaId, mesaId),
          eq(schema.visitaMesa.estado, 'abierta'),
        ),
      );
    if (!visita)
      throw new NotFoundException('No hay visita activa en esta mesa');
    return visita;
  }

  // ─── Pedido para llevar ───────────────────────────────────────────────────

  async abrirVisitaParaLlevar(usuarioId: string, nombreCliente?: string) {
    // Busca o crea una mesa virtual numero=0 reservada para llevar
    let [mesaLlevar] = await this.db
      .select()
      .from(schema.mesa)
      .where(eq(schema.mesa.numero, 0));

    if (!mesaLlevar) {
      [mesaLlevar] = await this.db
        .insert(schema.mesa)
        .values({ numero: 0, capacidad: null })
        .returning();
    }

    // Crea la visita con paraLlevar=true sin tocar el estado de la mesa
    const [visita] = await this.db
      .insert(schema.visitaMesa)
      .values({
        mesaId: mesaLlevar.id,
        abiertaPorUsuarioId: usuarioId,
        paraLlevar: true,
        tipo: 'llevar',
        nombreCliente: nombreCliente || null,
      })
      .returning();

    return visita;
  }

  // ─── Abrir mesa ───────────────────────────────────────────────────────────

  async abrirMesa(mesaId: string, usuarioId: string) {
    const [mesa] = await this.db
      .select()
      .from(schema.mesa)
      .where(eq(schema.mesa.id, mesaId));

    if (!mesa) throw new NotFoundException('Mesa no encontrada');
    if (mesa.estado === 'ocupada')
      throw new BadRequestException(`Mesa ${mesa.numero} ya está ocupada`);

    // Abrir visita + marcar mesa en una transacción
    return this.db.transaction(async (tx) => {
      const [visita] = await tx
        .insert(schema.visitaMesa)
        .values({ mesaId, abiertaPorUsuarioId: usuarioId })
        .returning();

      await tx
        .update(schema.mesa)
        .set({ estado: 'ocupada', updatedAt: new Date() })
        .where(eq(schema.mesa.id, mesaId));

      return visita;
    });
  }

  // ─── Detalle de visita ────────────────────────────────────────────────────

  async getVisita(visitaId: string) {
    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.id, visitaId));

    if (!visita) throw new NotFoundException('Visita no encontrada');

    const pedidos = await this.db
      .select()
      .from(schema.pedido)
      .where(eq(schema.pedido.visitaMesaId, visitaId));

    const pedidoIds = pedidos.map((p) => p.id);
    const items =
      pedidoIds.length > 0
        ? await this.db
            .select()
            .from(schema.itemPedido)
            .where(inArray(schema.itemPedido.pedidoId, pedidoIds))
        : [];

    const pedidosConItems = pedidos.map((p) => ({
      ...p,
      items: items.filter((i) => i.pedidoId === p.id),
    }));

    const total = items
      .filter((i) => i.estado !== 'cancelado')
      .reduce(
        (sum, i) => sum + parseFloat(i.precioUnitarioCongelado) * i.cantidad,
        0,
      );

    return { ...visita, pedidos: pedidosConItems, total: total.toFixed(2) };
  }

  // ─── Crear pedido (ronda) ─────────────────────────────────────────────────

  async crearPedido(
    visitaId: string,
    usuarioId: string,
    items: Array<{ platoCartaId: string; cantidad: number; notas?: string }>,
    opciones: { paraLlevar?: boolean; nombreClienteLlevar?: string } = {},
  ) {
    const paraLlevar = !!opciones.paraLlevar;
    const nombreClienteLlevar = opciones.nombreClienteLlevar?.trim() ?? '';
    if (paraLlevar && !nombreClienteLlevar) {
      throw new BadRequestException(
        'Se requiere el nombre del cliente para un pedido para llevar',
      );
    }

    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.id, visitaId));

    if (!visita) throw new NotFoundException('Visita no encontrada');
    if (visita.estado === 'cerrada')
      throw new BadRequestException('La visita ya está cerrada');

    // Verificar platos y obtener precios actuales con su categoría
    const platoIds = items.map((i) => i.platoCartaId);
    const platosRows = await this.db
      .select({
        plato: schema.platoCarta,
        categoria: schema.categoriaCarta,
      })
      .from(schema.platoCarta)
      .leftJoin(
        schema.categoriaCarta,
        eq(schema.platoCarta.categoriaId, schema.categoriaCarta.id),
      )
      .where(inArray(schema.platoCarta.id, platoIds));

    const platoMap = new Map(
      platosRows.map(({ plato, categoria }) => [
        plato.id,
        { ...plato, categoria },
      ]),
    );

    for (const item of items) {
      const plato = platoMap.get(item.platoCartaId);
      if (!plato)
        throw new NotFoundException(`Plato ${item.platoCartaId} no encontrado`);
      if (!plato.disponible)
        throw new BadRequestException(`"${plato.nombre}" no está disponible`);
    }

    // Obtener datos de mesa y mesero para el ticket
    const [mesa] = visita.mesaId
      ? await this.db
          .select()
          .from(schema.mesa)
          .where(eq(schema.mesa.id, visita.mesaId))
      : [null];

    const [mesero] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, usuarioId));

    // Resolver promociones vigentes una sola vez, fuera de la transacción.
    const promosPorPlato = await this.promociones.resolverPromocionesVigentes(
      items.map((i) => i.platoCartaId),
    );

    const resultado = await this.db.transaction(async (tx) => {
      const [pedido] = await tx
        .insert(schema.pedido)
        .values({
          visitaMesaId: visitaId,
          tomadoPorUsuarioId: usuarioId,
          paraLlevar,
          nombreClienteLlevar: paraLlevar ? nombreClienteLlevar : null,
        })
        .returning();

      if (paraLlevar && nombreClienteLlevar) {
        await tx
          .update(schema.visitaMesa)
          .set({
            tipo: 'llevar',
            nombreCliente: nombreClienteLlevar,
          })
          .where(eq(schema.visitaMesa.id, visitaId));
      }

      const itemsInsert = items.map((i) => {
        const plato = platoMap.get(i.platoCartaId)!;
        const precioBase = parseFloat(plato.precio);
        // El recargo por tupper/bolsa ya no es automático: se cobra agregando
        // manualmente el producto "Tupper" (categoría 'extras') al pedido.

        const promo = promosPorPlato.get(i.platoCartaId);
        const descuentoUnitario = promo
          ? this.promociones.calcularDescuentoUnitario(precioBase, promo)
          : 0;

        return {
          pedidoId: pedido.id,
          platoCartaId: i.platoCartaId,
          cantidad: i.cantidad,
          precioUnitarioCongelado: (precioBase - descuentoUnitario).toFixed(2),
          descuentoUnitario: descuentoUnitario.toFixed(2),
          promocionAplicadaId: promo?.id ?? null,
          notas: i.notas,
        };
      });

      const itemsCreados = await tx
        .insert(schema.itemPedido)
        .values(itemsInsert)
        .returning();

      // Todo plato con receta descuenta; si algo no alcanza, lanza y no se crea el pedido.
      await this.stock.descontarVenta(tx, itemsCreados, {
        pedidoId: pedido.id,
        usuarioId,
      });

      return { ...pedido, items: itemsCreados };
    });

    // Imprimir comanda: solo platos preparados en cocina (esParaCocina = true).
    const itemsCocina = resultado.items.filter((i) => {
      const plato = platoMap.get(i.platoCartaId);
      return plato && plato.categoria?.esParaCocina;
    });

    if (itemsCocina.length > 0) {
      this.printer
        .printKitchenTicket({
          pedidoId: resultado.id,
          numeroCorto: resultado.numeroCorto,
          visitaId,
          mesaNumero: mesa?.numero ?? 0,
          mesero: mesero?.name ?? usuarioId,
          paraLlevar: resultado.paraLlevar,
          nombreClienteLlevar: resultado.nombreClienteLlevar ?? undefined,
          items: itemsCocina.map((i) => ({
            nombre: platoMap.get(i.platoCartaId)!.nombre,
            cantidad: i.cantidad,
            notas: i.notas,
          })),
          fechaCreacion: resultado.fechaCreacion,
        })
        .catch((err) => {
          this.logger.error(
            `Error al imprimir ticket de cocina (Mesa): ${err.message}`,
            err.stack,
          );
        });
    }

    return resultado;
  }

  // ─── Cambiar estado de pedido ─────────────────────────────────────────────

  async cambiarEstadoPedido(
    pedidoId: string,
    nuevoEstado: 'en_preparacion' | 'listo' | 'entregado' | 'cancelado',
    opciones: { motivoCancelacion?: string; usuarioId?: string } = {},
  ) {
    const [pedido] = await this.db
      .select()
      .from(schema.pedido)
      .where(eq(schema.pedido.id, pedidoId));

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const TRANSICIONES: Record<string, string[]> = {
      pendiente: ['en_preparacion', 'listo', 'entregado', 'cancelado'],
      en_preparacion: ['listo', 'entregado', 'cancelado'],
      listo: ['entregado', 'cancelado'],
      entregado: [],
      cancelado: [],
    };

    if (!TRANSICIONES[pedido.estado]?.includes(nuevoEstado)) {
      throw new BadRequestException(
        `No se puede pasar de "${pedido.estado}" a "${nuevoEstado}"`,
      );
    }

    const motivoCancelacion = opciones.motivoCancelacion?.trim();
    if (nuevoEstado === 'cancelado' && !motivoCancelacion) {
      throw new BadRequestException('El motivo de cancelación es obligatorio');
    }

    const timestamps: Partial<typeof schema.pedido.$inferInsert> = {};
    if (nuevoEstado === 'listo') timestamps.fechaListo = new Date();
    if (nuevoEstado === 'entregado') timestamps.fechaEntregado = new Date();
    if (nuevoEstado === 'cancelado')
      timestamps.motivoCancelacion = motivoCancelacion;

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.pedido)
        .set({ estado: nuevoEstado, ...timestamps })
        .where(eq(schema.pedido.id, pedidoId))
        .returning();

      // Anular la ronda devuelve el stock de los ítems que seguían vivos.
      if (nuevoEstado === 'cancelado') {
        const vivos = await tx
          .select()
          .from(schema.itemPedido)
          .where(
            and(
              eq(schema.itemPedido.pedidoId, pedidoId),
              notInArray(schema.itemPedido.estado, ['cancelado']),
            ),
          );
        for (const item of vivos) {
          await this.stock.restaurarItem(tx, item, opciones.usuarioId ?? null);
        }
        if (vivos.length)
          await tx
            .update(schema.itemPedido)
            .set({ estado: 'cancelado' })
            .where(
              inArray(
                schema.itemPedido.id,
                vivos.map((i) => i.id),
              ),
            );
      }

      return updated;
    });
  }

  async cancelarItemPedido(itemId: string, usuarioId?: string) {
    const [item] = await this.db
      .select()
      .from(schema.itemPedido)
      .where(eq(schema.itemPedido.id, itemId));
    if (!item) throw new NotFoundException('Ítem de pedido no encontrado');
    if (item.estado === 'cancelado')
      throw new BadRequestException('El producto ya está cancelado');

    // 1. Marcar como cancelado y 2. devolver el stock (si aplica)
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.itemPedido)
        .set({ estado: 'cancelado' })
        .where(eq(schema.itemPedido.id, itemId))
        .returning();
      await this.stock.restaurarItem(tx, item, usuarioId ?? null);
      return row;
    });

    // 3. Si todos los ítems de esta ronda fueron cancelados, cancelar también la ronda completa
    const otrosItems = await this.db
      .select()
      .from(schema.itemPedido)
      .where(eq(schema.itemPedido.pedidoId, item.pedidoId));

    const todosCancelados = otrosItems.every((i) => i.estado === 'cancelado');
    if (todosCancelados) {
      await this.db
        .update(schema.pedido)
        .set({
          estado: 'cancelado',
          motivoCancelacion:
            'Todos los productos fueron cancelados individualmente',
        })
        .where(eq(schema.pedido.id, item.pedidoId));
    }

    return updated;
  }

  // ─── Imprimir cuenta (sin cerrar) ────────────────────────────────────────

  async imprimirCuenta(visitaId: string) {
    const visita = await this.getVisita(visitaId);
    if (visita.estado === 'cerrada')
      throw new BadRequestException('La visita ya está cerrada');

    const [mesa] = visita.mesaId
      ? await this.db
          .select()
          .from(schema.mesa)
          .where(eq(schema.mesa.id, visita.mesaId))
      : [null];

    const items = visita.pedidos
      .filter((p) => p.estado !== 'cancelado')
      .flatMap((p) => p.items);

    const platoIds = [...new Set(items.map((i) => i.platoCartaId))];
    const platos = platoIds.length
      ? await this.db
          .select()
          .from(schema.platoCarta)
          .where(inArray(schema.platoCarta.id, platoIds))
      : [];
    const platoMap = new Map(platos.map((p) => [p.id, p]));

    const resumen = new Map<
      string,
      {
        nombre: string;
        cantidad: number;
        precioUnitario: string;
        descuentoUnitario: string;
      }
    >();
    for (const item of items) {
      const key = `${item.platoCartaId}::${item.descuentoUnitario}`;
      if (resumen.has(key)) {
        resumen.get(key)!.cantidad += item.cantidad;
      } else {
        resumen.set(key, {
          nombre: platoMap.get(item.platoCartaId)?.nombre ?? item.platoCartaId,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitarioCongelado,
          descuentoUnitario: item.descuentoUnitario ?? '0.00',
        });
      }
    }

    this.printer
      .printReceipt({
        visitaId,
        mesaNumero: mesa?.numero ?? 0,
        items: Array.from(resumen.values()),
        total: visita.total,
        descuentoTotal: '0.00',
        metodoPago: 'pendiente',
        fechaPago: new Date(),
      })
      .catch((err) => {
        this.logger.error(
          `Error al imprimir precuenta (Mesero): ${err.message}`,
          err.stack,
        );
      });

    return { ok: true };
  }

  // ─── Cobrar desde mesero (busca turno de caja abierto) ───────────────────

  async registrarPagoMesero(
    usuarioId: string,
    visitaId: string,
    pagos: Array<{
      metodoPago: 'efectivo' | 'tarjeta' | 'yape_plin' | 'transferencia';
      monto: number;
    }>,
  ) {
    if (!pagos.length)
      throw new BadRequestException('Debe incluir al menos un método de pago');

    // Buscar cualquier turno de caja abierto
    const [turno] = await this.db
      .select()
      .from(schema.turnoCaja)
      .where(eq(schema.turnoCaja.estado, 'abierto'));

    if (!turno)
      throw new BadRequestException(
        'No hay turno de caja abierto. Pide al cajero que abra el turno.',
      );

    const [pagoExistente] = await this.db
      .select()
      .from(schema.pago)
      .where(eq(schema.pago.visitaMesaId, visitaId));
    if (pagoExistente)
      throw new ConflictException('Esta visita ya fue cobrada');

    const visita = await this.getVisita(visitaId);
    if (visita.estado === 'cerrada')
      throw new BadRequestException('La visita ya está cerrada');

    const totalEsperado = parseFloat(visita.total);
    const totalRecibido = pagos.reduce((s, p) => s + p.monto, 0);
    if (Math.abs(totalRecibido - totalEsperado) > 0.01) {
      throw new BadRequestException(
        `La suma de pagos (S/${totalRecibido.toFixed(2)}) no coincide con el total (S/${visita.total})`,
      );
    }

    const [mesa] = visita.mesaId
      ? await this.db
          .select()
          .from(schema.mesa)
          .where(eq(schema.mesa.id, visita.mesaId))
      : [null];

    const items = visita.pedidos
      .filter((p) => p.estado !== 'cancelado')
      .flatMap((p) => p.items);

    const platoIds = [...new Set(items.map((i) => i.platoCartaId))];
    const platos = platoIds.length
      ? await this.db
          .select()
          .from(schema.platoCarta)
          .where(inArray(schema.platoCarta.id, platoIds))
      : [];
    const platoMap = new Map(platos.map((p) => [p.id, p]));

    const resumen = new Map<
      string,
      {
        nombre: string;
        cantidad: number;
        precioUnitario: string;
        descuentoUnitario: string;
      }
    >();
    for (const item of items) {
      const key = `${item.platoCartaId}::${item.descuentoUnitario}`;
      if (resumen.has(key)) {
        resumen.get(key)!.cantidad += item.cantidad;
      } else {
        resumen.set(key, {
          nombre: platoMap.get(item.platoCartaId)?.nombre ?? item.platoCartaId,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitarioCongelado,
          descuentoUnitario: item.descuentoUnitario ?? '0.00',
        });
      }
    }

    await this.db.insert(schema.pago).values(
      pagos.map((p) => ({
        turnoCajaId: turno.id,
        visitaMesaId: visitaId,
        registradoPorUsuarioId: usuarioId,
        metodoPago: p.metodoPago,
        montoTotal: p.monto.toFixed(2),
      })),
    );

    await this.db
      .update(schema.visitaMesa)
      .set({ estado: 'cerrada', fechaCierre: new Date() })
      .where(eq(schema.visitaMesa.id, visitaId));

    if (visita.mesaId) {
      await this.db
        .update(schema.mesa)
        .set({ estado: 'libre', updatedAt: new Date() })
        .where(eq(schema.mesa.id, visita.mesaId));
    }

    const metodosLabel = pagos
      .map((p) => p.metodoPago.replace('_', '/'))
      .join(' + ');
    this.printer
      .printReceipt({
        visitaId,
        mesaNumero: mesa?.numero ?? 0,
        items: Array.from(resumen.values()),
        total: visita.total,
        descuentoTotal: '0.00',
        metodoPago: metodosLabel,
        fechaPago: new Date(),
      })
      .catch((err) => {
        this.logger.error(
          `Error al imprimir recibo (Pago Mesero): ${err.message}`,
          err.stack,
        );
      });

    return { ok: true };
  }

  // ─── Cerrar visita ────────────────────────────────────────────────────────

  async cerrarVisita(visitaId: string) {
    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.id, visitaId));

    if (!visita) throw new NotFoundException('Visita no encontrada');
    if (visita.estado === 'cerrada')
      throw new BadRequestException('La visita ya está cerrada');

    // Liberación libre: solo se permite cerrar sin pago si no hay consumo (todos
    // los pedidos cancelados o sin items). Si hay consumo, debe cobrarse en caja
    // — el cobro internamente cierra la visita.
    const pedidosNoCancelados = await this.db
      .select()
      .from(schema.pedido)
      .where(
        and(
          eq(schema.pedido.visitaMesaId, visitaId),
          notInArray(schema.pedido.estado, ['cancelado']),
        ),
      );

    if (pedidosNoCancelados.length > 0) {
      const ids = pedidosNoCancelados.map((p) => p.id);
      const items = await this.db
        .select()
        .from(schema.itemPedido)
        .where(inArray(schema.itemPedido.pedidoId, ids));

      const consumoTotal = items.reduce(
        (s, i) => s + parseFloat(i.precioUnitarioCongelado) * i.cantidad,
        0,
      );

      if (consumoTotal > 0) {
        const [pagoExistente] = await this.db
          .select()
          .from(schema.pago)
          .where(eq(schema.pago.visitaMesaId, visitaId));

        if (!pagoExistente) {
          throw new BadRequestException(
            'Hay consumo sin cobrar. La mesa debe cobrarse en caja antes de liberarse.',
          );
        }
      }
    }

    return this.db.transaction(async (tx) => {
      const [visitaCerrada] = await tx
        .update(schema.visitaMesa)
        .set({ estado: 'cerrada', fechaCierre: new Date() })
        .where(eq(schema.visitaMesa.id, visitaId))
        .returning();

      // La mesa virtual (para llevar, numero=0) siempre queda libre; no cambiar estado
      if (visita.mesaId) {
        await tx
          .update(schema.mesa)
          .set({ estado: 'libre', updatedAt: new Date() })
          .where(eq(schema.mesa.id, visita.mesaId));
      }

      return visitaCerrada;
    });
  }

  // ─── Listar visitas activas para llevar y delivery ───────────────────────

  async getVisitasActivasLlevarDelivery() {
    const visitas = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(
        and(
          eq(schema.visitaMesa.estado, 'abierta'),
          inArray(schema.visitaMesa.tipo, ['llevar', 'delivery']),
        ),
      );

    if (visitas.length === 0) return [];

    const visitaIds = visitas.map((v) => v.id);

    const pedidos = await this.db
      .select()
      .from(schema.pedido)
      .where(
        and(
          inArray(schema.pedido.visitaMesaId, visitaIds),
          notInArray(schema.pedido.estado, ['cancelado']),
        ),
      );

    const items = pedidos.length
      ? await this.db
          .select()
          .from(schema.itemPedido)
          .where(
            inArray(
              schema.itemPedido.pedidoId,
              pedidos.map((p) => p.id),
            ),
          )
      : [];

    return visitas.map((visita) => {
      const pedidosVisita = pedidos.filter((p) => p.visitaMesaId === visita.id);
      const itemsVisita = items.filter((i) =>
        pedidosVisita.some((p) => p.id === i.pedidoId),
      );
      const totalItems = itemsVisita
        .filter((i) => i.estado !== 'cancelado')
        .reduce(
          (sum, i) => sum + parseFloat(i.precioUnitarioCongelado) * i.cantidad,
          0,
        );
      const costoEnvioVal =
        visita.tipo === 'delivery' && visita.costoEnvio
          ? parseFloat(visita.costoEnvio)
          : 0;
      const total = totalItems + costoEnvioVal;

      return {
        id: visita.id,
        tipo: visita.tipo,
        nombreCliente: visita.nombreCliente,
        telefonoCliente: visita.telefonoCliente,
        direccionDelivery: visita.direccionDelivery,
        costoEnvio: visita.costoEnvio,
        fechaApertura: visita.fechaApertura,
        total: total.toFixed(2),
        cantidadItems: itemsVisita
          .filter((i) => i.estado !== 'cancelado')
          .reduce((sum, i) => sum + i.cantidad, 0),
      };
    });
  }
}
