import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isIPv4 } from 'net';
import { DRIZZLE } from '../db/db.module';
import * as schema from '../db/schema';

export type TipoTicketera = 'cocina' | 'recibos';
export type ModoTicketera = 'simulada' | 'red';

export interface TicketeraConfig {
  tipo: TipoTicketera;
  modo: ModoTicketera;
  ip: string | null;
  puerto: number;
}

export const TICKETERA_LABEL: Record<TipoTicketera, string> = {
  cocina: 'Cocina / Comanda',
  recibos: 'Caja / Recibos',
};

const TIPOS: TipoTicketera[] = ['cocina', 'recibos'];

// La configuración vive en la tabla `ticketera` y se lee en cada impresión,
// así un cambio desde Administración aplica sin reiniciar el servidor.
@Injectable()
export class TicketeraConfigService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async list(): Promise<TicketeraConfig[]> {
    const rows = await this.db.select().from(schema.ticketera);
    return TIPOS.map(
      (tipo) =>
        rows.find((r) => r.tipo === tipo) ?? {
          tipo,
          modo: 'simulada' as const,
          ip: null,
          puerto: 9100,
        },
    ).map(({ tipo, modo, ip, puerto }) => ({ tipo, modo, ip, puerto }));
  }

  async get(tipo: TipoTicketera): Promise<TicketeraConfig> {
    const all = await this.list();
    return all.find((t) => t.tipo === tipo)!;
  }

  async update(
    tipo: TipoTicketera,
    body: { modo?: ModoTicketera; ip?: string | null; puerto?: number },
  ): Promise<TicketeraConfig> {
    const actual = await this.get(tipo);
    const modo = body.modo ?? actual.modo;
    const ip =
      body.ip === undefined ? actual.ip : body.ip?.trim() ? body.ip.trim() : null;
    const puerto = body.puerto ?? actual.puerto;

    if (modo !== 'simulada' && modo !== 'red')
      throw new BadRequestException('Modo inválido');
    if (ip !== null && !isIPv4(ip))
      throw new BadRequestException('La IP no es una dirección IPv4 válida');
    if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535)
      throw new BadRequestException('El puerto debe estar entre 1 y 65535');
    if (modo === 'red' && !ip)
      throw new BadRequestException('Para imprimir en red se necesita una IP');

    await this.db
      .insert(schema.ticketera)
      .values({ tipo, modo, ip, puerto })
      .onConflictDoUpdate({
        target: schema.ticketera.tipo,
        set: { modo, ip, puerto, updatedAt: new Date() },
      });

    return { tipo, modo, ip, puerto };
  }
}
