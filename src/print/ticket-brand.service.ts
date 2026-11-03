import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import sharp from 'sharp';
import { DRIZZLE } from '../db/db.module';
import * as schema from '../db/schema';

// Ancho en puntos del logo: ocupa dos tercios de los 576 puntos del papel de 80 mm y va centrado.
const LOGO_ANCHO = 384;
const LOGO_ALTO_MAX = 160;
const UMBRAL = 160;

export interface MarcaTicket {
  nombre: string;
  direccion: string;
  telefono: string;
  /** Comando ESC/POS (GS v 0) con el logo en blanco y negro; null si no hay logo o no se pudo leer. */
  logo: Buffer | null;
}

// Nombre, datos y logo del local para la cabecera de los tickets.
@Injectable()
export class TicketBrandService {
  private readonly logger = new Logger(TicketBrandService.name);
  private cache: { fuente: string; raster: Buffer | null } | null = null;

  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async get(): Promise<MarcaTicket> {
    let cfg: typeof schema.localConfig.$inferSelect | undefined;
    try {
      [cfg] = await this.db
        .select()
        .from(schema.localConfig)
        .where(eq(schema.localConfig.id, 'principal'));
    } catch (err) {
      this.logger.warn(`No se pudo leer la configuración del local: ${err}`);
    }
    return {
      nombre: cfg?.nombre || process.env.STORE_NAME || 'FoxEats',
      direccion: cfg?.direccion ?? '',
      telefono: cfg?.telefono ?? '',
      logo: cfg?.logo ? await this.rasterizar(cfg.logo) : null,
    };
  }

  private async rasterizar(dataUrl: string): Promise<Buffer | null> {
    if (this.cache?.fuente === dataUrl) return this.cache.raster;
    let raster: Buffer | null = null;
    try {
      const bytes = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
      const { data, info } = await sharp(bytes)
        .flatten({ background: '#ffffff' }) // PNG/WebP transparente → fondo blanco
        .resize({ width: LOGO_ANCHO, height: LOGO_ALTO_MAX, fit: 'inside' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bytesPorFila = Math.ceil(info.width / 8);
      const bits = Buffer.alloc(bytesPorFila * info.height);
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[y * info.width + x] < UMBRAL)
            bits[y * bytesPorFila + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
      // GS v 0 m xL xH yL yH d...
      raster = Buffer.concat([
        Buffer.from([
          0x1d, 0x76, 0x30, 0x00,
          bytesPorFila & 0xff, bytesPorFila >> 8,
          info.height & 0xff, info.height >> 8,
        ]),
        bits,
      ]);
    } catch (err) {
      this.logger.warn(`No se pudo preparar el logo para el ticket: ${err}`);
    }
    this.cache = { fuente: dataUrl, raster };
    return raster;
  }
}
