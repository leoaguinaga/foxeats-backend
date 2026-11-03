import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { KitchenTicketData, ReceiptData } from './print.interface';
import { TicketBrandService } from './ticket-brand.service';
import { comandaCocina, recibo } from './ticket-builders';

export interface PrinterTarget {
  ip: string;
  port: number;
}

// Envía tickets ESC/POS por TCP. El destino (ip:puerto) lo decide
// TicketeraPrintService a partir de la configuración guardada en la DB.
@Injectable()
export class RealPrintService {
  private readonly logger = new Logger(RealPrintService.name);

  constructor(private readonly marca: TicketBrandService) {}

  async printKitchenTicket(
    data: KitchenTicketData,
    { ip, port }: PrinterTarget,
  ): Promise<void> {
    await this.sendTcp(ip, port, comandaCocina(data, await this.marca.get()).aEscPos());
    this.logger.log(`[RED] Comanda → Mesa ${data.mesaNumero} (${ip}:${port})`);
  }

  async printBarTicket(
    data: KitchenTicketData,
    { ip, port }: PrinterTarget,
  ): Promise<void> {
    await this.sendTcp(ip, port, comandaCocina(data, await this.marca.get(), 'COMANDA · CAJA').aEscPos());
    this.logger.log(`[RED] Comanda de caja → Mesa ${data.mesaNumero} (${ip}:${port})`);
  }

  async printReceipt(
    data: ReceiptData,
    { ip, port }: PrinterTarget,
  ): Promise<void> {
    await this.sendTcp(ip, port, recibo(data, await this.marca.get()).aEscPos());
    this.logger.log(
      `[RED] Recibo → Mesa ${data.mesaNumero} S/${data.total} (${ip}:${port})`,
    );
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
        reject(new Error(`Timeout ticketera ${ip}`));
      });
    });
  }
}
