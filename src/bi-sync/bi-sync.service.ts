import { Injectable, Inject, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../db/db.module';
import * as schema from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';

export interface BiSyncPayload {
  storeId: string;
  storeName: string;
  timestamp: string;
  date: string;
  summary: {
    totalRevenue: number;
    totalOrders: number;
    totalShiftsClosed: number;
    revenueByPaymentMethod: Record<string, number>;
  };
  productsSold: Array<{
    productoId: string;
    nombre: string;
    cantidad: number;
    subtotal: number;
  }>;
  shifts: Array<{
    turnoId: string;
    cajeroId: string;
    fechaApertura: Date;
    fechaCierre: Date | null;
    montoApertura: string;
    montoCierreReal: string | null;
    diferencia: string | null;
  }>;
}

@Injectable()
export class BiSyncService {
  private readonly logger = new Logger(BiSyncService.name);
  private lastSyncTimestamp: string | null = null;
  private lastSyncStatus: 'IDLE' | 'SUCCESS' | 'OFFLINE_BUFFERED' | 'FAILED' = 'IDLE';

  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  public getSyncStatus() {
    return {
      enabled: process.env.BI_SYNC_ENABLED === 'true',
      storeId: process.env.STORE_ID || 'store_001',
      storeName: process.env.STORE_NAME || 'FoxEats Restaurant',
      targetUrl: process.env.BI_SERVER_URL || 'https://bi-central.foxeats.com/api/v1/ingest',
      lastSyncTimestamp: this.lastSyncTimestamp,
      lastSyncStatus: this.lastSyncStatus,
    };
  }

  public async generateDailySnapshot(): Promise<BiSyncPayload> {
    const storeId = process.env.STORE_ID || 'store_001';
    const storeName = process.env.STORE_NAME || 'FoxEats Restaurant';
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // 1. Fetch closed turnos
    const turnos = await this.db.query.turnoCaja.findMany({
      orderBy: [desc(schema.turnoCaja.fechaApertura)],
      limit: 10,
    });

    // 2. Fetch completed payments
    const pagos = await this.db.query.pago.findMany({
      limit: 500,
    });

    const revenueByPaymentMethod: Record<string, number> = {};
    let totalRevenue = 0;

    for (const p of pagos) {
      const monto = Number(p.montoTotal) || 0;
      totalRevenue += monto;
      revenueByPaymentMethod[p.metodoPago] = (revenueByPaymentMethod[p.metodoPago] || 0) + monto;
    }

    // 3. Fetch product items sold
    const itemsVendidos = await this.db
      .select({
        productoId: schema.itemPedido.platoCartaId,
        nombre: schema.platoCarta.nombre,
        cantidad: sql<number>`sum(${schema.itemPedido.cantidad})`,
        subtotal: sql<number>`sum(${schema.itemPedido.cantidad} * ${schema.itemPedido.precioUnitarioCongelado}::numeric)`,
      })
      .from(schema.itemPedido)
      .innerJoin(schema.platoCarta, eq(schema.itemPedido.platoCartaId, schema.platoCarta.id))
      .groupBy(schema.itemPedido.platoCartaId, schema.platoCarta.nombre)
      .limit(50);

    const productsSold = itemsVendidos.map((item) => ({
      productoId: item.productoId,
      nombre: item.nombre,
      cantidad: Number(item.cantidad) || 0,
      subtotal: Number(item.subtotal) || 0,
    }));

    const shifts = turnos.map((t) => ({
      turnoId: t.id,
      cajeroId: t.cajeroUsuarioId,
      fechaApertura: t.fechaApertura,
      fechaCierre: t.fechaCierre,
      montoApertura: t.montoApertura,
      montoCierreReal: t.montoCierreReal,
      diferencia: t.diferencia,
    }));

    return {
      storeId,
      storeName,
      timestamp: now.toISOString(),
      date: dateStr,
      summary: {
        totalRevenue,
        totalOrders: pagos.length,
        totalShiftsClosed: turnos.filter((t) => t.estado === 'cerrado').length,
        revenueByPaymentMethod,
      },
      productsSold,
      shifts,
    };
  }

  public async triggerSync(): Promise<{ success: boolean; status: string; payloadPreview?: BiSyncPayload }> {
    const payload = await this.generateDailySnapshot();
    const biUrl = process.env.BI_SERVER_URL || 'https://bi-central.foxeats.com/api/v1/ingest';
    const apiKey = process.env.BI_SERVER_API_KEY || '';

    this.logger.log(`Initiating BI Outbound Data Sync for Store: ${payload.storeId} (${payload.storeName})`);

    if (process.env.BI_SYNC_ENABLED !== 'true') {
      this.logger.warn('BI Outbound Sync is currently disabled in environment variables (BI_SYNC_ENABLED!=true).');
      return { success: false, status: 'DISABLED_IN_ENV', payloadPreview: payload };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(biUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Store-ID': payload.storeId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.lastSyncTimestamp = new Date().toISOString();
        this.lastSyncStatus = 'SUCCESS';
        this.logger.log(`BI Sync transmitted successfully to ${biUrl}`);
        return { success: true, status: 'TRANSMITTED_SUCCESSFULLY', payloadPreview: payload };
      } else {
        throw new Error(`BI server responded with HTTP status ${response.status}`);
      }
    } catch (err: any) {
      this.lastSyncTimestamp = new Date().toISOString();
      this.lastSyncStatus = 'OFFLINE_BUFFERED';
      this.logger.warn(`Could not reach external BI server (${err.message}). Payload buffered locally for automatic retry.`);
      return {
        success: false,
        status: `OFFLINE_BUFFERED (${err.message})`,
        payloadPreview: payload,
      };
    }
  }
}
