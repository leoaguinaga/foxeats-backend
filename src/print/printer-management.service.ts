import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import {
  ModoTicketera,
  TICKETERA_LABEL,
  TicketeraConfigService,
  TipoTicketera,
} from './ticketera-config.service';

export interface PrinterInfo {
  tipo: TipoTicketera;
  label: string;
  modo: ModoTicketera;
  ip: string | null;
  port: number;
  online: boolean;
  latencyMs?: number;
}

@Injectable()
export class PrinterManagementService {
  private readonly logger = new Logger(PrinterManagementService.name);

  constructor(private readonly config: TicketeraConfigService) {}

  async getTicketeras(): Promise<PrinterInfo[]> {
    const ticketeras = await this.config.list();
    return Promise.all(
      ticketeras.map(async (t) => {
        const base = {
          tipo: t.tipo,
          label: TICKETERA_LABEL[t.tipo],
          modo: t.modo,
          ip: t.ip,
          port: t.puerto,
        };
        if (!t.ip) return { ...base, online: false };
        const { online, latencyMs } = await this.probe(t.ip, t.puerto);
        return { ...base, online, latencyMs };
      }),
    );
  }

  async updateTicketera(
    tipo: TipoTicketera,
    body: { modo?: ModoTicketera; ip?: string | null; puerto?: number },
  ): Promise<void> {
    await this.config.update(tipo, body);
  }

  async testPrint(tipo: TipoTicketera): Promise<void> {
    const t = await this.config.get(tipo);
    if (!t.ip) throw new Error(`Ticketera "${tipo}" sin IP configurada`);
    const label = TICKETERA_LABEL[tipo];
    const buf = this.buildTestPage(label, t.ip);
    await this.sendTcp(t.ip, t.puerto, buf);
    this.logger.log(
      `[MGMT] Prueba de impresión enviada a ${label} (${t.ip}:${t.puerto})`,
    );
  }

  private probe(
    ip: string,
    port: number,
    timeoutMs = 2000,
  ): Promise<{ online: boolean; latencyMs?: number }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.connect(port, ip, () => {
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ online: true, latencyMs });
      });
      socket.on('error', () => resolve({ online: false }));
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ online: false });
      });
    });
  }

  private sendTcp(ip: string, port: number, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(port, ip, () => {
        socket.write(data, (err) => {
          if (err) {
            socket.destroy();
            reject(err);
          } else {
            socket.end();
            resolve();
          }
        });
      });
      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Timeout al conectar con ticketera ${ip}`));
      });
    });
  }

  private buildTestPage(label: string, ip: string): Buffer {
    const ESC = '\x1b';
    const GS = '\x1d';
    const LF = '\x0a';

    const fecha = new Date().toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      hour12: false,
    });

    const parts = [
      `${ESC}\x40`,
      `${ESC}\x61\x01`,
      `${ESC}\x45\x01`,
      `MISTER LUKA${LF}`,
      `${ESC}\x45\x00`,
      `PRUEBA DE IMPRESION${LF}`,
      `--------------------------------${LF}`,
      `${ESC}\x61\x00`,
      `Ticketera: ${label}${LF}`,
      `IP:        ${ip}${LF}`,
      `Hora:      ${fecha}${LF}`,
      `--------------------------------${LF}`,
      `${ESC}\x61\x01`,
      `Funciona correctamente${LF}`,
      `${LF}${LF}${LF}`,
      `${GS}\x56\x42\x00`,
    ];

    return Buffer.from(parts.join(''), 'latin1');
  }
}
