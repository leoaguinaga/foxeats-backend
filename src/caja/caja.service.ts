import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, inArray, notInArray, sql, gte, desc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../db/db.module';
import { PRINT_SERVICE } from '../print/print.interface';
import type { PrintService } from '../print/print.interface';
import { PromocionesService } from '../promociones/promociones.service';
import { StockService } from '../stock/stock.service';
import * as schema from '../db/schema';

type MetodoPago = 'efectivo' | 'tarjeta' | 'yape_plin' | 'transferencia';

@Injectable()
export class CajaService {
  private readonly logger = new Logger(CajaService.name);
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    @Inject(PRINT_SERVICE) private printer: PrintService,
    private readonly promociones: PromocionesService,
    private readonly stock: StockService,
  ) {}

  // ─── Turno activo ─────────────────────────────────────────────────────────

  async getTurnoActivo() {
    const [turno] = await this.db
      .select()
      .from(schema.turnoCaja)
      .where(eq(schema.turnoCaja.estado, 'abierto'));
    return turno ?? null;
  }

  async getTurnoConPagos(cajeroId: string) {
    const turno = await this.getTurnoActivo();
    if (!turno) return null;

    // Join pago → visitaMesa → mesa para obtener el número de mesa
    const pagos = await this.db
      .select({
        id: schema.pago.id,
        visitaMesaId: schema.pago.visitaMesaId,
        metodoPago: schema.pago.metodoPago,
        montoTotal: schema.pago.montoTotal,
        fechaPago: schema.pago.fechaPago,
        mesaNumero: schema.mesa.numero,
        visitaTipo: schema.visitaMesa.tipo,
        nombreCliente: schema.visitaMesa.nombreCliente,
      })
      .from(schema.pago)
      .leftJoin(
        schema.visitaMesa,
        eq(schema.pago.visitaMesaId, schema.visitaMesa.id),
      )
      .leftJoin(schema.mesa, eq(schema.visitaMesa.mesaId, schema.mesa.id))
      .where(eq(schema.pago.turnoCajaId, turno.id))
      .orderBy(schema.pago.fechaPago);

    const gastos = await this.db
      .select()
      .from(schema.gasto)
      .where(eq(schema.gasto.turnoCajaId, turno.id))
      .orderBy(schema.gasto.createdAt);

    // Totales por canal de pago
    const porCanal = {
      efectivo: 0,
      tarjeta: 0,
      yape_plin: 0,
      transferencia: 0,
    };
    for (const p of pagos) {
      const m = p.metodoPago;
      if (m in porCanal) porCanal[m] += parseFloat(p.montoTotal);
    }

    const totalEfectivo = porCanal.efectivo;
    const totalTurno = Object.values(porCanal).reduce((s, v) => s + v, 0);
    const totalGastos = gastos.reduce((s, g) => s + parseFloat(g.monto), 0);

    return {
      ...turno,
      pagos,
      gastos,
      porCanal: {
        efectivo: porCanal.efectivo.toFixed(2),
        tarjeta: porCanal.tarjeta.toFixed(2),
        yape_plin: porCanal.yape_plin.toFixed(2),
        transferencia: porCanal.transferencia.toFixed(2),
      },
      totalEfectivo: totalEfectivo.toFixed(2),
      totalTurno: totalTurno.toFixed(2),
      totalGastos: totalGastos.toFixed(2),
      montoCierreTeorico: (
        parseFloat(turno.montoApertura) +
        totalEfectivo -
        totalGastos
      ).toFixed(2),
    };
  }

  // ─── Abrir turno ──────────────────────────────────────────────────────────

  async abrirTurno(cajeroId: string, montoApertura: number) {
    const turnoExistente = await this.getTurnoActivo();
    if (turnoExistente) {
      throw new ConflictException('Ya hay un turno de caja abierto');
    }

    const [turno] = await this.db
      .insert(schema.turnoCaja)
      .values({
        cajeroUsuarioId: cajeroId,
        montoApertura: montoApertura.toFixed(2),
      })
      .returning();

    return turno;
  }

  async registrarGasto(
    cajeroId: string,
    data: { monto: number; motivo: string },
  ) {
    const turno = await this.getTurnoActivo();
    if (!turno) {
      throw new BadRequestException('No hay turno de caja abierto');
    }

    const [nuevoGasto] = await this.db
      .insert(schema.gasto)
      .values({
        turnoCajaId: turno.id,
        cajeroUsuarioId: cajeroId,
        monto: data.monto.toFixed(2),
        motivo: data.motivo.trim(),
      })
      .returning();

    return nuevoGasto;
  }

  async editarGasto(
    cajeroId: string,
    gastoId: string,
    data: { monto: number; motivo: string },
  ) {
    const turno = await this.getTurnoActivo();
    if (!turno) {
      throw new BadRequestException('No hay turno de caja abierto');
    }

    const [gastoExistente] = await this.db
      .select()
      .from(schema.gasto)
      .where(
        and(
          eq(schema.gasto.id, gastoId),
          eq(schema.gasto.turnoCajaId, turno.id),
        ),
      );

    if (!gastoExistente) {
      throw new NotFoundException('Gasto no encontrado en el turno activo');
    }

    const [gastoActualizado] = await this.db
      .update(schema.gasto)
      .set({
        monto: data.monto.toFixed(2),
        motivo: data.motivo.trim(),
      })
      .where(eq(schema.gasto.id, gastoId))
      .returning();

    return gastoActualizado;
  }

  async eliminarGasto(cajeroId: string, gastoId: string) {
    const turno = await this.getTurnoActivo();
    if (!turno) {
      throw new BadRequestException('No hay turno de caja abierto');
    }

    const [gastoExistente] = await this.db
      .select()
      .from(schema.gasto)
      .where(
        and(
          eq(schema.gasto.id, gastoId),
          eq(schema.gasto.turnoCajaId, turno.id),
        ),
      );

    if (!gastoExistente) {
      throw new NotFoundException('Gasto no encontrado en el turno activo');
    }

    await this.db.delete(schema.gasto).where(eq(schema.gasto.id, gastoId));

    return { ok: true };
  }

  // ─── Mesas listas para cobrar ─────────────────────────────────────────────

  async getMesasParaCobrar() {
    const visitasAbiertas = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.estado, 'abierta'));

    if (!visitasAbiertas.length) return [];

    const visitaIds = visitasAbiertas.map((v) => v.id);

    // Solo pedidos no cancelados
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

    const mesas = await this.db.select().from(schema.mesa);
    const mesaMap = new Map(mesas.map((m) => [m.id, m]));

    // Visitas que ya tienen pago → no mostrar de nuevo
    const pagosExistentes = await this.db
      .select()
      .from(schema.pago)
      .where(inArray(schema.pago.visitaMesaId, visitaIds));
    const visitasYaCobradas = new Set(
      pagosExistentes.map((p) => p.visitaMesaId),
    );

    return visitasAbiertas
      .filter((v) => !visitasYaCobradas.has(v.id))
      .map((visita) => {
        const pedidosVisita = pedidos.filter(
          (p) => p.visitaMesaId === visita.id,
        );
        const itemsVisita = items.filter((i) =>
          pedidosVisita.some((p) => p.id === i.pedidoId),
        );
        const totalItems = itemsVisita.reduce(
          (s, i) => s + parseFloat(i.precioUnitarioCongelado) * i.cantidad,
          0,
        );
        const costoEnvioVal =
          visita.tipo === 'delivery' && visita.costoEnvio
            ? parseFloat(visita.costoEnvio)
            : 0;
        const total = totalItems + costoEnvioVal;

        const mesa = visita.mesaId ? mesaMap.get(visita.mesaId) : null;
        return {
          visitaId: visita.id,
          mesaId: visita.mesaId,
          mesaNumero: mesa?.numero ?? null,
          tipo: visita.tipo,
          nombreCliente: visita.nombreCliente,
          telefonoCliente: visita.telefonoCliente,
          direccionDelivery: visita.direccionDelivery,
          costoEnvio: visita.costoEnvio,
          paraLlevar: visita.paraLlevar,
          fechaApertura: visita.fechaApertura,
          total: total.toFixed(2),
          pedidos: pedidosVisita.length,
          // Para llevar o delivery con todo lo de cocina listo y sin entregar.
          listo:
            visita.tipo !== 'mesa' &&
            pedidosVisita.length > 0 &&
            pedidosVisita.every((p) =>
              ['listo', 'entregado'].includes(p.estado),
            ) &&
            pedidosVisita.some((p) => p.estado === 'listo'),
        };
      })
      .sort((a, b) => {
        if (a.mesaNumero !== null && b.mesaNumero !== null) {
          return a.mesaNumero - b.mesaNumero;
        }
        if (a.mesaNumero !== null) return -1;
        if (b.mesaNumero !== null) return 1;
        return (
          new Date(b.fechaApertura).getTime() -
          new Date(a.fechaApertura).getTime()
        );
      });
  }

  // ─── Detalle de visita para cobrar ────────────────────────────────────────

  async getDetalleVisita(visitaId: string) {
    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.id, visitaId));

    if (!visita) throw new NotFoundException('Visita no encontrada');

    // Todos los pedidos no cancelados (incluyendo pendientes y en preparación)
    const pedidos = await this.db
      .select()
      .from(schema.pedido)
      .where(
        and(
          eq(schema.pedido.visitaMesaId, visitaId),
          notInArray(schema.pedido.estado, ['cancelado']),
        ),
      );

    const items = pedidos.length
      ? await this.db
          .select()
          .from(schema.itemPedido)
          .where(
            and(
              inArray(
                schema.itemPedido.pedidoId,
                pedidos.map((p) => p.id),
              ),
              notInArray(schema.itemPedido.estado, ['cancelado']),
            ),
          )
      : [];

    const platos = items.length
      ? await this.db
          .select()
          .from(schema.platoCarta)
          .where(
            inArray(
              schema.platoCarta.id,
              items.map((i) => i.platoCartaId),
            ),
          )
      : [];

    const platoMap = new Map(platos.map((p) => [p.id, p]));

    const [mesa] = visita.mesaId
      ? await this.db
          .select()
          .from(schema.mesa)
          .where(eq(schema.mesa.id, visita.mesaId))
      : [null];

    const totalItems = items.reduce(
      (s, i) => s + parseFloat(i.precioUnitarioCongelado) * i.cantidad,
      0,
    );

    const costoEnvioVal =
      visita.tipo === 'delivery' && visita.costoEnvio
        ? parseFloat(visita.costoEnvio)
        : 0;
    const total = totalItems + costoEnvioVal;

    const descuentoTotal = items.reduce(
      (s, i) => s + parseFloat(i.descuentoUnitario ?? '0') * i.cantidad,
      0,
    );

    // Agrupar items por plato (mismo plato + mismo descuento se considera misma línea)
    const resumen = new Map<
      string,
      {
        nombre: string;
        cantidad: number;
        precioUnitario: string;
        descuentoUnitario: string;
        itemIds: string[];
      }
    >();
    for (const item of items) {
      const plato = platoMap.get(item.platoCartaId);
      const key = `${item.platoCartaId}::${item.descuentoUnitario}`;
      if (resumen.has(key)) {
        resumen.get(key)!.cantidad += item.cantidad;
        resumen.get(key)!.itemIds.push(item.id);
      } else {
        resumen.set(key, {
          nombre: plato?.nombre ?? item.platoCartaId,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitarioCongelado,
          descuentoUnitario: item.descuentoUnitario ?? '0.00',
          itemIds: [item.id],
        });
      }
    }

    return {
      visitaId,
      mesaNumero: mesa?.numero ?? null,
      tipo: visita.tipo,
      nombreCliente: visita.nombreCliente,
      telefonoCliente: visita.telefonoCliente,
      direccionDelivery: visita.direccionDelivery,
      costoEnvio: visita.costoEnvio,
      fechaApertura: visita.fechaApertura,
      resumen: Array.from(resumen.values()),
      total: total.toFixed(2),
      descuentoTotal: descuentoTotal.toFixed(2),
    };
  }

  // ─── Imprimir precuenta (resumen sin cobrar) ─────────────────────────────
  // El cajero puede llamar este endpoint las veces que necesite antes del
  // pago; no marca la visita como cobrada ni hace nada en la BD.

  async imprimirPrecuenta(visitaId: string) {
    const detalle = await this.getDetalleVisita(visitaId);

    const [pagoExistente] = await this.db
      .select()
      .from(schema.pago)
      .where(eq(schema.pago.visitaMesaId, visitaId));
    if (pagoExistente) {
      throw new BadRequestException(
        'Esta visita ya fue cobrada — no se emite precuenta',
      );
    }

    await this.printer
      .printReceipt({
        visitaId,
        mesaNumero: detalle.mesaNumero ?? 0,
        tipoVisita: detalle.tipo,
        nombreCliente: detalle.nombreCliente ?? undefined,
        telefonoCliente: detalle.telefonoCliente ?? undefined,
        direccionDelivery: detalle.direccionDelivery ?? undefined,
        costoEnvio: detalle.costoEnvio ?? undefined,
        items: detalle.resumen,
        total: detalle.total,
        descuentoTotal: detalle.descuentoTotal,
        esPrecuenta: true,
        metodoPago: '',
        fechaPago: new Date(),
      })
      .catch((err) => {
        this.logger.error(
          `Error al imprimir precuenta: ${err.message}`,
          err.stack,
        );
      });

    return { ok: true, total: detalle.total };
  }

  // ─── Registrar pago (acepta múltiples métodos de pago + ajuste opcional) ──

  async registrarPago(
    cajeroId: string,
    visitaId: string,
    pagos: Array<{ metodoPago: MetodoPago; monto: number }>,
    ajuste?: { motivo: string; monto: number },
  ) {
    const turno = await this.getTurnoActivo();
    if (!turno) throw new BadRequestException('No hay turno de caja abierto');

    if (!pagos.length)
      throw new BadRequestException('Debe incluir al menos un método de pago');

    // Verificar que no se haya cobrado ya
    const [pagoExistente] = await this.db
      .select()
      .from(schema.pago)
      .where(eq(schema.pago.visitaMesaId, visitaId));
    if (pagoExistente)
      throw new ConflictException('Esta visita ya fue cobrada');

    const detalle = await this.getDetalleVisita(visitaId);
    const totalItems = parseFloat(detalle.total);

    // Validar ajuste si se proporcionó
    let ajusteMonto = 0;
    let motivoAjuste: string | null = null;
    if (ajuste && Math.abs(ajuste.monto) > 0.005) {
      ajusteMonto = ajuste.monto;
      motivoAjuste = (ajuste.motivo ?? '').trim();
      if (!motivoAjuste) {
        throw new BadRequestException('El ajuste manual requiere un motivo');
      }
    }

    const totalEsperado = totalItems + ajusteMonto;
    if (totalEsperado < 0) {
      throw new BadRequestException(
        'El ajuste no puede dejar el total en negativo',
      );
    }

    const totalRecibido = pagos.reduce((s, p) => s + p.monto, 0);
    if (Math.abs(totalRecibido - totalEsperado) > 0.01) {
      throw new BadRequestException(
        `La suma de pagos (S/${totalRecibido.toFixed(2)}) no coincide con el total a cobrar (S/${totalEsperado.toFixed(2)})`,
      );
    }

    // Insertar todos los pagos. El ajuste solo va en la primera fila para
    // tener un registro único auditable de la decisión del cajero.
    const nuevosPagos = await this.db
      .insert(schema.pago)
      .values(
        pagos.map((p, idx) => ({
          turnoCajaId: turno.id,
          visitaMesaId: visitaId,
          registradoPorUsuarioId: cajeroId,
          metodoPago: p.metodoPago,
          montoTotal: p.monto.toFixed(2),
          ajusteMonto:
            idx === 0 && ajusteMonto !== 0 ? ajusteMonto.toFixed(2) : null,
          motivoAjuste: idx === 0 ? motivoAjuste : null,
        })),
      )
      .returning();

    // Cerrar visita y liberar mesa
    await this.db
      .update(schema.visitaMesa)
      .set({ estado: 'cerrada', fechaCierre: new Date() })
      .where(eq(schema.visitaMesa.id, visitaId));

    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.id, visitaId));

    if (visita && visita.mesaId) {
      await this.db
        .update(schema.mesa)
        .set({ estado: 'libre', updatedAt: new Date() })
        .where(eq(schema.mesa.id, visita.mesaId));
    }

    // Imprimir recibo (no bloqueante)
    const metodosLabel = pagos
      .map((p) => p.metodoPago.replace('_', '/'))
      .join(' + ');
    this.printer
      .printReceipt({
        visitaId,
        mesaNumero: detalle.mesaNumero ?? 0,
        tipoVisita: detalle.tipo,
        nombreCliente: detalle.nombreCliente ?? undefined,
        telefonoCliente: detalle.telefonoCliente ?? undefined,
        direccionDelivery: detalle.direccionDelivery ?? undefined,
        costoEnvio: detalle.costoEnvio ?? undefined,
        items: detalle.resumen,
        total: detalle.total,
        descuentoTotal: detalle.descuentoTotal,
        ajusteMonto: ajusteMonto !== 0 ? ajusteMonto.toFixed(2) : undefined,
        motivoAjuste: motivoAjuste ?? undefined,
        metodoPago: metodosLabel,
        fechaPago: new Date(),
      })
      .catch((err) => {
        this.logger.error(
          `Error al imprimir recibo: ${err.message}`,
          err.stack,
        );
      });

    return nuevosPagos;
  }

  // ─── Cerrar turno ─────────────────────────────────────────────────────────

  async cerrarTurno(cajeroId: string, montoCierreReal: number) {
    const turno = await this.getTurnoActivo();
    if (!turno) throw new NotFoundException('No hay turno abierto');

    const pagos = await this.db
      .select()
      .from(schema.pago)
      .where(eq(schema.pago.turnoCajaId, turno.id));

    const totalEfectivo = pagos
      .filter((p) => p.metodoPago === 'efectivo')
      .reduce((s, p) => s + parseFloat(p.montoTotal), 0);

    const [gastosRecord] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${schema.gasto.monto}), '0.00')`,
      })
      .from(schema.gasto)
      .where(eq(schema.gasto.turnoCajaId, turno.id));
    const totalGastos = parseFloat(gastosRecord?.total ?? '0');

    const montoCierreTeorico =
      parseFloat(turno.montoApertura) + totalEfectivo - totalGastos;
    const diferencia = montoCierreReal - montoCierreTeorico;

    const [turnoCerrado] = await this.db
      .update(schema.turnoCaja)
      .set({
        estado: 'cerrado',
        montoCierreTeorico: montoCierreTeorico.toFixed(2),
        montoCierreReal: montoCierreReal.toFixed(2),
        diferencia: diferencia.toFixed(2),
        fechaCierre: new Date(),
      })
      .where(eq(schema.turnoCaja.id, turno.id))
      .returning();

    return turnoCerrado;
  }

  /** «Cliente N» correlativo de los pedidos de mostrador del turno abierto. */
  private async siguienteClienteN() {
    const turno = await this.getTurnoActivo();
    const desde = turno?.fechaApertura ?? new Date(Date.now() - 12 * 3600_000);
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.visitaMesa)
      .where(
        and(
          inArray(schema.visitaMesa.tipo, ['llevar', 'delivery']),
          gte(schema.visitaMesa.fechaApertura, desde),
        ),
      );
    return `Cliente ${n + 1}`;
  }

  /**
   * Los platos más vendidos en los últimos 30 días, para la categoría
   * «Más pedidos». La caja prioriza para llevar y delivery; el mesero, lo
   * vendido en salón. Si todavía hay pocos datos de ese tipo, usa todas las ventas.
   */
  async masPedidos(limite = 8, preferir: 'mostrador' | 'mesa' = 'mostrador') {
    const desde = new Date(Date.now() - 30 * 86_400_000);
    const total = sql<number>`sum(${schema.itemPedido.cantidad})::int`;
    const tipos: Array<'mesa' | 'llevar' | 'delivery'> =
      preferir === 'mesa' ? ['mesa'] : ['llevar', 'delivery'];
    const consultar = (filtrar: boolean) =>
      this.db
        .select({ platoId: schema.itemPedido.platoCartaId, total })
        .from(schema.itemPedido)
        .innerJoin(
          schema.pedido,
          eq(schema.itemPedido.pedidoId, schema.pedido.id),
        )
        .innerJoin(
          schema.visitaMesa,
          eq(schema.pedido.visitaMesaId, schema.visitaMesa.id),
        )
        .where(
          and(
            gte(schema.pedido.fechaCreacion, desde),
            notInArray(schema.itemPedido.estado, ['cancelado']),
            filtrar ? inArray(schema.visitaMesa.tipo, tipos) : undefined,
          ),
        )
        .groupBy(schema.itemPedido.platoCartaId)
        .orderBy(desc(total))
        .limit(limite);

    let filas = await consultar(true);
    if (filas.length < 4) filas = await consultar(false);
    return filas.map((f) => f.platoId);
  }

  // ─── Crear Pedido Para Llevar desde Caja ─────────────────────────────────

  async crearPedidoLlevar(
    cajeroId: string,
    data: {
      nombreCliente?: string;
      items: Array<{ platoCartaId: string; cantidad: number; notas?: string }>;
    },
  ) {
    // Sin nombre, el pedido sale como «Cliente N»: es lo que se grita al entregar.
    const nombreCliente =
      data.nombreCliente?.trim() || (await this.siguienteClienteN());
    if (!data.items?.length) {
      throw new BadRequestException('Debe incluir al menos un plato');
    }

    // Verificar platos y obtener precios
    const platoIds = data.items.map((i) => i.platoCartaId);
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

    for (const item of data.items) {
      const plato = platoMap.get(item.platoCartaId);
      if (!plato)
        throw new NotFoundException(`Plato ${item.platoCartaId} no encontrado`);
      if (!plato.disponible)
        throw new BadRequestException(`"${plato.nombre}" no está disponible`);
    }

    const [cajero] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, cajeroId));

    const promosPorPlato =
      await this.promociones.resolverPromocionesVigentes(platoIds);

    const resultado = await this.db.transaction(async (tx) => {
      const [visita] = await tx
        .insert(schema.visitaMesa)
        .values({
          abiertaPorUsuarioId: cajeroId,
          tipo: 'llevar',
          paraLlevar: true,
          nombreCliente,
        })
        .returning();

      const [pedido] = await tx
        .insert(schema.pedido)
        .values({
          visitaMesaId: visita.id,
          tomadoPorUsuarioId: cajeroId,
          paraLlevar: true,
          nombreClienteLlevar: nombreCliente,
        })
        .returning();

      const itemsInsert = data.items.map((i) => {
        const plato = platoMap.get(i.platoCartaId)!;
        const precioBase = parseFloat(plato.precio);
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

      // Todo plato con receta descuenta; si algo no alcanza, no se crea el pedido.
      await this.stock.descontarVenta(tx, itemsCreados, {
        pedidoId: pedido.id,
        usuarioId: cajeroId,
      });

      return { visita, pedido, items: itemsCreados };
    });

    const itemsCocina = resultado.items.filter((i) => {
      const plato = platoMap.get(i.platoCartaId);
      return plato && plato.categoria?.esParaCocina;
    });

    if (itemsCocina.length > 0) {
      this.printer
        .printKitchenTicket({
          pedidoId: resultado.pedido.id,
          numeroCorto: resultado.pedido.numeroCorto,
          visitaId: resultado.visita.id,
          mesaNumero: 0,
          mesero: cajero?.name ?? cajeroId,
          paraLlevar: true,
          nombreClienteLlevar: nombreCliente,
          items: itemsCocina.map((i) => ({
            nombre: platoMap.get(i.platoCartaId)!.nombre,
            cantidad: i.cantidad,
            notas: i.notas,
          })),
          fechaCreacion: resultado.pedido.fechaCreacion,
        })
        .catch((err) => {
          this.logger.error(
            `Error al imprimir ticket de cocina (Llevar): ${err.message}`,
            err.stack,
          );
        });
    }

    return { ok: true, visitaId: resultado.visita.id, nombreCliente };
  }

  // ─── Crear Pedido Delivery desde Caja ────────────────────────────────────

  async crearPedidoDelivery(
    cajeroId: string,
    data: {
      nombreCliente: string;
      telefonoCliente?: string;
      direccionDelivery: string;
      costoEnvio: number;
      items: Array<{ platoCartaId: string; cantidad: number; notas?: string }>;
    },
  ) {
    const nombreCliente = data.nombreCliente.trim();
    const direccionDelivery = data.direccionDelivery.trim();
    if (!nombreCliente) {
      throw new BadRequestException('Se requiere el nombre del cliente');
    }
    if (!direccionDelivery) {
      throw new BadRequestException('Se requiere la dirección de entrega');
    }
    if (!data.items?.length) {
      throw new BadRequestException('Debe incluir al menos un plato');
    }

    // Verificar platos
    const platoIds = data.items.map((i) => i.platoCartaId);
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

    for (const item of data.items) {
      const plato = platoMap.get(item.platoCartaId);
      if (!plato)
        throw new NotFoundException(`Plato ${item.platoCartaId} no encontrado`);
      if (!plato.disponible)
        throw new BadRequestException(`"${plato.nombre}" no está disponible`);
    }

    const [cajero] = await this.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, cajeroId));

    const promosPorPlato =
      await this.promociones.resolverPromocionesVigentes(platoIds);

    const resultado = await this.db.transaction(async (tx) => {
      const [visita] = await tx
        .insert(schema.visitaMesa)
        .values({
          abiertaPorUsuarioId: cajeroId,
          tipo: 'delivery',
          paraLlevar: true,
          nombreCliente,
          telefonoCliente: data.telefonoCliente?.trim() || null,
          direccionDelivery,
          costoEnvio: data.costoEnvio.toFixed(2),
        })
        .returning();

      const [pedido] = await tx
        .insert(schema.pedido)
        .values({
          visitaMesaId: visita.id,
          tomadoPorUsuarioId: cajeroId,
          paraLlevar: true,
          nombreClienteLlevar: nombreCliente,
        })
        .returning();

      const itemsInsert = data.items.map((i) => {
        const plato = platoMap.get(i.platoCartaId)!;
        const precioBase = parseFloat(plato.precio);
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

      // Todo plato con receta descuenta; si algo no alcanza, no se crea el pedido.
      await this.stock.descontarVenta(tx, itemsCreados, {
        pedidoId: pedido.id,
        usuarioId: cajeroId,
      });

      return { visita, pedido, items: itemsCreados };
    });

    const itemsCocina = resultado.items.filter((i) => {
      const plato = platoMap.get(i.platoCartaId);
      return plato && plato.categoria?.esParaCocina;
    });

    if (itemsCocina.length > 0) {
      this.printer
        .printKitchenTicket({
          pedidoId: resultado.pedido.id,
          numeroCorto: resultado.pedido.numeroCorto,
          visitaId: resultado.visita.id,
          mesaNumero: 0,
          mesero: cajero?.name ?? cajeroId,
          paraLlevar: true,
          nombreClienteLlevar: nombreCliente,
          items: itemsCocina.map((i) => ({
            nombre: platoMap.get(i.platoCartaId)!.nombre,
            cantidad: i.cantidad,
            notas: i.notas,
          })),
          fechaCreacion: resultado.pedido.fechaCreacion,
        })
        .catch((err) => {
          this.logger.error(
            `Error al imprimir ticket de cocina (Delivery): ${err.message}`,
            err.stack,
          );
        });
    }

    return { ok: true, visitaId: resultado.visita.id, nombreCliente };
  }

  // ─── Cancelar Visita (Pedido Completo) desde Caja ────────────────────────

  async cancelarVisita(visitaId: string, motivo: string, usuarioId?: string) {
    const [visita] = await this.db
      .select()
      .from(schema.visitaMesa)
      .where(eq(schema.visitaMesa.id, visitaId));

    if (!visita) throw new NotFoundException('Visita no encontrada');
    if (visita.estado === 'cerrada')
      throw new BadRequestException('El pedido ya está cerrado');

    const motivoLimpio = motivo?.trim() || 'Cancelado desde Caja';

    return this.db.transaction(async (tx) => {
      // 1. Obtener todos los pedidos no cancelados de esta visita
      const pedidos = await tx
        .select()
        .from(schema.pedido)
        .where(
          and(
            eq(schema.pedido.visitaMesaId, visitaId),
            notInArray(schema.pedido.estado, ['cancelado']),
          ),
        );

      // 2. Para cada pedido, cancelarlo y restaurar stock de sus ítems
      for (const p of pedidos) {
        await tx
          .update(schema.pedido)
          .set({ estado: 'cancelado', motivoCancelacion: motivoLimpio })
          .where(eq(schema.pedido.id, p.id));

        const items = await tx
          .select()
          .from(schema.itemPedido)
          .where(eq(schema.itemPedido.pedidoId, p.id));

        for (const item of items) {
          if (item.estado !== 'cancelado') {
            await tx
              .update(schema.itemPedido)
              .set({ estado: 'cancelado' })
              .where(eq(schema.itemPedido.id, item.id));

            // Restaurar stock
            await this.stock.restaurarItem(tx, item, usuarioId ?? null);
          }
        }
      }

      // 3. Cerrar la visita
      await tx
        .update(schema.visitaMesa)
        .set({ estado: 'cerrada', fechaCierre: new Date() })
        .where(eq(schema.visitaMesa.id, visitaId));

      // 4. Si tiene mesa asociada, liberarla
      if (visita.mesaId) {
        await tx
          .update(schema.mesa)
          .set({ estado: 'libre', updatedAt: new Date() })
          .where(eq(schema.mesa.id, visita.mesaId));
      }

      return { ok: true };
    });
  }
}
