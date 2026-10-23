import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, gte, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../db/db.module';
import * as schema from '../db/schema';

type Metodo = 'efectivo' | 'tarjeta' | 'yape_plin' | 'transferencia';
type TipoVisita = 'mesa' | 'llevar' | 'delivery';

const METODOS: Metodo[] = ['efectivo', 'tarjeta', 'yape_plin', 'transferencia'];
const TIPOS: TipoVisita[] = ['mesa', 'llevar', 'delivery'];

// Lima no tiene horario de verano: el desfase es fijo y el servidor puede
// correr en UTC (Docker), así que el día y la hora se leen siempre en Lima.
const OFFSET_LIMA_H = 5;
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

// Diferencia de arqueo por debajo de la cual el turno cuenta como «cuadra».
const MARGEN_ARQUEO = 0.005;

function limaParts(d: Date) {
  const l = new Date(d.getTime() - OFFSET_LIMA_H * HORA_MS);
  return {
    fecha: l.toISOString().slice(0, 10),
    hora: l.getUTCHours(),
  };
}

function inicioDiaLima(fecha: string) {
  return new Date(`${fecha}T00:00:00-05:00`);
}

function hoyLima() {
  return limaParts(new Date()).fecha;
}

function fechaValida(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

const n = (v: string | null | undefined) => parseFloat(v ?? '0') || 0;
const money = (v: number) => v.toFixed(2);

function porCanalVacio(): Record<Metodo, number> {
  return { efectivo: 0, tarjeta: 0, yape_plin: 0, transferencia: 0 };
}

function canalesTexto(c: Record<Metodo, number>) {
  return {
    efectivo: money(c.efectivo),
    tarjeta: money(c.tarjeta),
    yape_plin: money(c.yape_plin),
    transferencia: money(c.transferencia),
  };
}

export interface FiltroCaja {
  desde?: string;
  hasta?: string;
  cajero?: string;
}

@Injectable()
export class CajaReportesService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  private rango(f: FiltroCaja) {
    const hoy = hoyLima();
    let desde = fechaValida(f.desde) ? f.desde : hoy;
    let hasta = fechaValida(f.hasta) ? f.hasta : desde;
    if (hasta < desde) [desde, hasta] = [hasta, desde];
    return {
      desde,
      hasta,
      inicio: inicioDiaLima(desde),
      fin: new Date(inicioDiaLima(hasta).getTime() + DIA_MS),
    };
  }

  /** Turnos que se cruzan con el rango, más cualquier turno aún abierto. */
  private async cargarTurnos(inicio: Date, fin: Date) {
    return this.db
      .select({ turno: schema.turnoCaja, cajeroNombre: schema.user.name })
      .from(schema.turnoCaja)
      .leftJoin(
        schema.user,
        eq(schema.turnoCaja.cajeroUsuarioId, schema.user.id),
      )
      .where(
        and(
          lt(schema.turnoCaja.fechaApertura, fin),
          or(
            eq(schema.turnoCaja.estado, 'abierto'),
            isNull(schema.turnoCaja.fechaCierre),
            gte(schema.turnoCaja.fechaCierre, inicio),
          ),
        ),
      )
      .orderBy(asc(schema.turnoCaja.fechaApertura));
  }

  // ─── Resumen del período ─────────────────────────────────────────────────

  async resumen(f: FiltroCaja) {
    const { desde, hasta, inicio, fin } = this.rango(f);
    const todos = await this.cargarTurnos(inicio, fin);

    const cajerosMap = new Map<string, string>();
    for (const t of todos) {
      cajerosMap.set(t.turno.cajeroUsuarioId, t.cajeroNombre ?? 'Desconocido');
    }
    const cajeros = [...cajerosMap].map(([id, nombre]) => ({ id, nombre }));

    const filas = f.cajero
      ? todos.filter((t) => t.turno.cajeroUsuarioId === f.cajero)
      : todos;

    const turnoIds = filas.map((t) => t.turno.id);
    const pagos = turnoIds.length
      ? await this.db
          .select({
            id: schema.pago.id,
            turnoCajaId: schema.pago.turnoCajaId,
            visitaMesaId: schema.pago.visitaMesaId,
            metodoPago: schema.pago.metodoPago,
            montoTotal: schema.pago.montoTotal,
            ajusteMonto: schema.pago.ajusteMonto,
            motivoAjuste: schema.pago.motivoAjuste,
            fechaPago: schema.pago.fechaPago,
            visitaTipo: schema.visitaMesa.tipo,
            mesaNumero: schema.mesa.numero,
            clienteNombre: schema.visitaMesa.nombreCliente,
            direccion: schema.visitaMesa.direccionDelivery,
          })
          .from(schema.pago)
          .leftJoin(
            schema.visitaMesa,
            eq(schema.pago.visitaMesaId, schema.visitaMesa.id),
          )
          .leftJoin(schema.mesa, eq(schema.visitaMesa.mesaId, schema.mesa.id))
          .where(inArray(schema.pago.turnoCajaId, turnoIds))
      : [];
    const gastos = turnoIds.length
      ? await this.db
          .select()
          .from(schema.gasto)
          .where(inArray(schema.gasto.turnoCajaId, turnoIds))
      : [];

    const turnos = filas
      .map(({ turno, cajeroNombre }) => {
        const pagosT = pagos.filter((p) => p.turnoCajaId === turno.id);
        const gastosT = gastos.filter((g) => g.turnoCajaId === turno.id);
        const canal = porCanalVacio();
        for (const p of pagosT) canal[p.metodoPago] += n(p.montoTotal);
        const total = METODOS.reduce((s, m) => s + canal[m], 0);
        const totalGastos = gastosT.reduce((s, g) => s + n(g.monto), 0);
        // Mientras el turno está abierto no hay valor guardado: se calcula en vivo.
        const esperado =
          turno.estado === 'abierto'
            ? n(turno.montoApertura) + canal.efectivo - totalGastos
            : n(turno.montoCierreTeorico);
        return {
          ...turno,
          cajeroNombre: cajeroNombre ?? 'Desconocido',
          porCanal: canalesTexto(canal),
          totalTurno: money(total),
          totalGastos: money(totalGastos),
          montoCierreTeorico: money(esperado),
          cobros: new Set(pagosT.map((p) => p.visitaMesaId)).size,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.fechaApertura).getTime() -
          new Date(a.fechaApertura).getTime(),
      );

    // Totales del período
    const canal = porCanalVacio();
    for (const p of pagos) canal[p.metodoPago] += n(p.montoTotal);
    const ingresos = METODOS.reduce((s, m) => s + canal[m], 0);
    const totalGastos = gastos.reduce((s, g) => s + n(g.monto), 0);

    const cuentas = new Set(pagos.map((p) => p.visitaMesaId));
    const porTipo = TIPOS.map((tipo) => {
      const delTipo = pagos.filter((p) => (p.visitaTipo ?? 'mesa') === tipo);
      return {
        tipo,
        monto: money(delTipo.reduce((s, p) => s + n(p.montoTotal), 0)),
        cuentas: new Set(delTipo.map((p) => p.visitaMesaId)).size,
      };
    });

    const cerrados = turnos.filter((t) => t.estado === 'cerrado');
    const conDiferencia = cerrados.filter(
      (t) => Math.abs(n(t.diferencia)) >= MARGEN_ARQUEO,
    );
    const sumaDiferencias = cerrados.reduce((s, t) => s + n(t.diferencia), 0);

    const abierto = turnos.find((t) => t.estado === 'abierto') ?? null;

    // Serie: por hora si es un solo día, por día en períodos largos.
    const porHora = desde === hasta;
    const buckets = new Map<string, number>();
    for (const p of pagos) {
      const l = limaParts(p.fechaPago);
      const clave = porHora ? String(l.hora) : l.fecha;
      buckets.set(clave, (buckets.get(clave) ?? 0) + n(p.montoTotal));
    }
    let serie: Array<{ clave: string; monto: string }>;
    if (porHora) {
      const horas = [...buckets.keys()].map(Number);
      // Cubre también las horas de turnos sin cobros para que el eje no salte.
      // Solo cuentan los extremos que caen en el día pedido.
      const delDia = (d: Date) => {
        const l = limaParts(d);
        if (l.fecha === desde) horas.push(l.hora);
      };
      for (const t of turnos) {
        delDia(new Date(t.fechaApertura));
        if (t.fechaCierre) delDia(new Date(t.fechaCierre));
      }
      if (abierto) delDia(new Date());
      const min = horas.length ? Math.min(...horas) : 8;
      const max = horas.length ? Math.max(...horas) : 22;
      serie = [];
      for (let h = min; h <= max; h++) {
        serie.push({ clave: String(h), monto: money(buckets.get(String(h)) ?? 0) });
      }
    } else {
      serie = [];
      const dias = Math.round(
        (inicioDiaLima(hasta).getTime() - inicioDiaLima(desde).getTime()) /
          DIA_MS,
      );
      for (let i = 0; i <= dias; i++) {
        const clave = limaParts(
          new Date(inicioDiaLima(desde).getTime() + i * DIA_MS),
        ).fecha;
        serie.push({ clave, monto: money(buckets.get(clave) ?? 0) });
      }
    }

    const mejor = porHora
      ? null
      : serie.reduce<{ clave: string; monto: string } | null>(
          (b, s) => (!b || n(s.monto) > n(b.monto) ? s : b),
          null,
        );

    const ajustes = pagos
      .filter((p) => p.ajusteMonto && Math.abs(n(p.ajusteMonto)) >= 0.005)
      .map((p) => ({
        pagoId: p.id,
        turnoId: p.turnoCajaId,
        monto: money(n(p.ajusteMonto)),
        motivo: p.motivoAjuste,
        fecha: p.fechaPago,
        cuenta: etiquetaCuenta(p),
      }))
      .sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
      );

    return {
      desde,
      hasta,
      ahora: new Date().toISOString(),
      cajeros,
      turnos,
      resumen: {
        ingresos: money(ingresos),
        gastos: money(totalGastos),
        cantidadGastos: gastos.length,
        neto: money(ingresos - totalGastos),
        cuentas: cuentas.size,
        ticketPromedio: money(cuentas.size ? ingresos / cuentas.size : 0),
        porCanal: canalesTexto(canal),
        porTipo,
        serie,
        serieTipo: porHora ? ('hora' as const) : ('dia' as const),
        mejorDia: mejor ? mejor : null,
        gavetaAhora: abierto
          ? {
              monto: abierto.montoCierreTeorico,
              cajero: abierto.cajeroNombre,
              turnoId: abierto.id,
            }
          : null,
        arqueo: {
          diferencia: money(sumaDiferencias),
          turnosCerrados: cerrados.length,
          turnosConDiferencia: conDiferencia.length,
        },
        ajustes,
      },
    };
  }

  // ─── Detalle de un turno ─────────────────────────────────────────────────

  async detalle(turnoId: string) {
    const [fila] = await this.db
      .select({ turno: schema.turnoCaja, cajeroNombre: schema.user.name })
      .from(schema.turnoCaja)
      .leftJoin(
        schema.user,
        eq(schema.turnoCaja.cajeroUsuarioId, schema.user.id),
      )
      .where(eq(schema.turnoCaja.id, turnoId));
    if (!fila) throw new NotFoundException('Turno no encontrado');
    const { turno } = fila;

    const pagos = await this.db
      .select({
        id: schema.pago.id,
        visitaMesaId: schema.pago.visitaMesaId,
        metodoPago: schema.pago.metodoPago,
        montoTotal: schema.pago.montoTotal,
        ajusteMonto: schema.pago.ajusteMonto,
        motivoAjuste: schema.pago.motivoAjuste,
        fechaPago: schema.pago.fechaPago,
        mesaNumero: schema.mesa.numero,
        clienteNombre: schema.visitaMesa.nombreCliente,
        direccion: schema.visitaMesa.direccionDelivery,
        visitaTipo: schema.visitaMesa.tipo,
      })
      .from(schema.pago)
      .leftJoin(
        schema.visitaMesa,
        eq(schema.pago.visitaMesaId, schema.visitaMesa.id),
      )
      .leftJoin(schema.mesa, eq(schema.visitaMesa.mesaId, schema.mesa.id))
      .where(eq(schema.pago.turnoCajaId, turnoId))
      .orderBy(asc(schema.pago.fechaPago));

    const gastos = await this.db
      .select()
      .from(schema.gasto)
      .where(eq(schema.gasto.turnoCajaId, turnoId))
      .orderBy(asc(schema.gasto.createdAt));

    const canal = porCanalVacio();
    for (const p of pagos) canal[p.metodoPago] += n(p.montoTotal);
    const total = METODOS.reduce((s, m) => s + canal[m], 0);
    const totalGastos = gastos.reduce((s, g) => s + n(g.monto), 0);
    const esperado =
      turno.estado === 'abierto'
        ? n(turno.montoApertura) + canal.efectivo - totalGastos
        : n(turno.montoCierreTeorico);

    // Los pagos de una misma visita (pago dividido) se muestran como una cuenta.
    const cuentasMap = new Map<
      string,
      {
        visitaId: string;
        fecha: Date;
        etiqueta: string;
        metodos: Array<{ metodo: Metodo; monto: string }>;
        monto: number;
        ajusteMonto: string | null;
        motivoAjuste: string | null;
      }
    >();
    for (const p of pagos) {
      const c = cuentasMap.get(p.visitaMesaId) ?? {
        visitaId: p.visitaMesaId,
        fecha: p.fechaPago,
        etiqueta: etiquetaCuenta(p),
        metodos: [],
        monto: 0,
        ajusteMonto: null,
        motivoAjuste: null,
      };
      c.metodos.push({ metodo: p.metodoPago, monto: money(n(p.montoTotal)) });
      c.monto += n(p.montoTotal);
      if (p.ajusteMonto && Math.abs(n(p.ajusteMonto)) >= 0.005) {
        c.ajusteMonto = money(n(p.ajusteMonto));
        c.motivoAjuste = p.motivoAjuste;
      }
      if (p.fechaPago > c.fecha) c.fecha = p.fechaPago;
      cuentasMap.set(p.visitaMesaId, c);
    }
    const cuentas = [...cuentasMap.values()].map((c) => ({
      ...c,
      monto: money(c.monto),
    }));

    return {
      ...turno,
      cajeroNombre: fila.cajeroNombre ?? 'Desconocido',
      porCanal: canalesTexto(canal),
      totalTurno: money(total),
      totalGastos: money(totalGastos),
      montoCierreTeorico: money(esperado),
      cobros: cuentas.length,
      arqueo: {
        apertura: money(n(turno.montoApertura)),
        efectivo: money(canal.efectivo),
        gastos: money(totalGastos),
        esperado: money(esperado),
        contado: turno.montoCierreReal,
        diferencia: turno.diferencia,
      },
      cuentas,
      gastos,
    };
  }

  // ─── Exportar CSV ────────────────────────────────────────────────────────

  async exportarCsv(f: FiltroCaja) {
    const { desde, hasta, inicio, fin } = this.rango(f);
    const todos = await this.cargarTurnos(inicio, fin);
    const filas = f.cajero
      ? todos.filter((t) => t.turno.cajeroUsuarioId === f.cajero)
      : todos;
    const ids = filas.map((t) => t.turno.id);
    const cajeroPor = new Map(
      filas.map((t) => [t.turno.id, t.cajeroNombre ?? 'Desconocido']),
    );

    const pagos = ids.length
      ? await this.db
          .select({
            turnoCajaId: schema.pago.turnoCajaId,
            fechaPago: schema.pago.fechaPago,
            metodoPago: schema.pago.metodoPago,
            montoTotal: schema.pago.montoTotal,
            ajusteMonto: schema.pago.ajusteMonto,
            motivoAjuste: schema.pago.motivoAjuste,
            visitaTipo: schema.visitaMesa.tipo,
            mesaNumero: schema.mesa.numero,
            clienteNombre: schema.visitaMesa.nombreCliente,
            direccion: schema.visitaMesa.direccionDelivery,
          })
          .from(schema.pago)
          .leftJoin(
            schema.visitaMesa,
            eq(schema.pago.visitaMesaId, schema.visitaMesa.id),
          )
          .leftJoin(schema.mesa, eq(schema.visitaMesa.mesaId, schema.mesa.id))
          .where(inArray(schema.pago.turnoCajaId, ids))
      : [];
    const gastos = ids.length
      ? await this.db
          .select()
          .from(schema.gasto)
          .where(inArray(schema.gasto.turnoCajaId, ids))
      : [];

    type Fila = [Date, string[]];
    const lineas: Fila[] = [];
    const fmt = (d: Date) => {
      const l = new Date(d.getTime() - OFFSET_LIMA_H * HORA_MS);
      return [
        l.toISOString().slice(0, 10),
        l.toISOString().slice(11, 16),
      ] as const;
    };
    for (const p of pagos) {
      const [fecha, hora] = fmt(p.fechaPago);
      lineas.push([
        p.fechaPago,
        [
          fecha,
          hora,
          'Cobro',
          cajeroPor.get(p.turnoCajaId) ?? '',
          etiquetaCuenta(p),
          p.metodoPago,
          p.montoTotal,
          p.ajusteMonto ?? '',
          p.motivoAjuste ?? '',
        ],
      ]);
    }
    for (const g of gastos) {
      const [fecha, hora] = fmt(g.createdAt);
      lineas.push([
        g.createdAt,
        [
          fecha,
          hora,
          'Gasto',
          cajeroPor.get(g.turnoCajaId) ?? '',
          g.motivo,
          'efectivo',
          money(-n(g.monto)),
          '',
          '',
        ],
      ]);
    }
    lineas.sort((a, b) => a[0].getTime() - b[0].getTime());

    const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const cab = [
      'Fecha',
      'Hora',
      'Tipo',
      'Cajero',
      'Detalle',
      'Medio',
      'Monto',
      'Ajuste',
      'Motivo del ajuste',
    ];
    const csv = [cab, ...lineas.map((l) => l[1])]
      .map((r) => r.map(esc).join(','))
      .join('\r\n');
    return { nombre: `caja_${desde}_${hasta}.csv`, csv: '﻿' + csv };
  }
}

function etiquetaCuenta(p: {
  visitaTipo: TipoVisita | null;
  mesaNumero: number | null;
  clienteNombre: string | null;
  direccion?: string | null;
}) {
  if (p.visitaTipo === 'llevar') {
    return `Para llevar${p.clienteNombre ? ` · ${p.clienteNombre}` : ''}`;
  }
  if (p.visitaTipo === 'delivery') {
    const quien = p.direccion || p.clienteNombre;
    return `Delivery${quien ? ` · ${quien}` : ''}`;
  }
  return p.mesaNumero != null ? `Mesa ${p.mesaNumero}` : 'Mesa';
}
